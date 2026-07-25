#!/usr/bin/env node
// opencard-export — scan Apple Wallet payment cards, compare against the live
// OpenCard DB, and (optionally) export digital card art for contribution.
//
// Zero dependencies, plain ESM. Everything runs locally; nothing is uploaded.

import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanCards, defaultCardsDir } from '../lib/passes.mjs';
import { matchCard } from '../lib/match.mjs';
import {
  renderCardEntry,
  completenessMeter,
  colorEnabled,
  ANSI,
} from '../lib/render.mjs';
import { attributionLine, attributionNotice } from '../lib/attribution.mjs';
import {
  sha256,
  parsePngDimensions,
  artStatus,
  buildProvenanceBlock,
  provenanceSnippet,
  today,
} from '../lib/art.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_SLUG = 'github.com/thedavidweng/opencard-db';
const DB_URLS = [
  // raw.githubusercontent first: ~5-minute cache, so freshly-merged data
  // (renames, new art) is visible quickly; jsDelivr (~12h edge cache) is the
  // resilient fallback when raw is rate-limited or blocked.
  'https://raw.githubusercontent.com/thedavidweng/opencard-db/main/exports/cards-all.json',
  'https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@main/exports/cards-all.json',
];
const ISSUE_FORM_URL =
  'https://github.com/thedavidweng/opencard-db/issues/new?template=add-card.yml';

function readVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
    );
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ── argv ────────────────────────────────────────────────────────────────────
class ArgError extends Error {}

function parseArgs(argv) {
  const args = {
    help: false,
    version: false,
    export: false,
    exportDir: null,
    json: false,
    noRemote: false,
    repo: null,
    passesDir: null,
    color: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-v':
      case '--version':
        args.version = true;
        break;
      case '--export': {
        args.export = true;
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          args.exportDir = next;
          i++;
        }
        break;
      }
      case '--json':
        args.json = true;
        break;
      case '--no-remote':
        args.noRemote = true;
        break;
      case '--repo': {
        args.repo = argv[++i] || null;
        break;
      }
      case '--passes-dir': {
        args.passesDir = argv[++i] || null;
        break;
      }
      case '--no-color':
        args.color = false;
        break;
      default:
        throw new ArgError(
          `opencard-export: unknown option '${a}'\n` +
            `Run 'opencard-export --help' to see available options.`,
        );
    }
  }
  return args;
}

// ── help / version ────────────────────────────────────────────────────────
function printHelp() {
  const v = readVersion();
  process.stdout.write(
    `opencard-export v${v}
Contribute Apple Pay card art to OpenCard DB.

Usage:
  npx opencard-export [options]
  bunx opencard-export [options]

Default: scan Wallet payment cards and compare with the live DB (no files written).

Options:
  --export [dir]   export card art to dir (default ./, or images/ in a repo checkout)
  --json           machine-readable output (no ANSI)
  --no-remote      skip the live DB comparison (offline)
  --repo <path>    an OpenCard DB checkout; export writes straight into its images/
  --passes-dir <p> override the Wallet directory (advanced / testing)
  --no-color       disable color (also respects NO_COLOR)
  -h, --help       show this help
  -v, --version    show version

Privacy: everything runs locally, nothing is uploaded; no PANs or tokens are read.
Card art remains the issuing bank's copyright (see SECURITY.md).
`,
  );
}

// ── FDA guide (the single most important UX in the tool) ─────────────────────
function terminalAppName(env = process.env) {
  switch (env.TERM_PROGRAM) {
    case 'Apple_Terminal':
      return 'Terminal';
    case 'iTerm.app':
      return 'iTerm2';
    case 'vscode':
      return 'Visual Studio Code';
    case 'WarpTerminal':
      return 'Warp';
    case 'Hyper':
      return 'Hyper';
    case 'Tabby':
      return 'Tabby';
    default:
      return 'your terminal app';
  }
}

function printFdaGuide(env = process.env, extraEnoentNote = false) {
  const app = terminalAppName(env);
  const color = colorEnabled(env);
  const b = (s) => (color ? ANSI.bold + s + ANSI.reset : s);
  const y = (s) => (color ? ANSI.yellow + s + ANSI.reset : s);
  const dim = (s) => (color ? ANSI.dim + s + ANSI.reset : s);
  const lines = [
    '',
    y('⚠  Cannot read your Apple Wallet cards.'),
    '',
    `   ${b(app)} needs macOS "Full Disk Access" to read ~/Library/Passes/.`,
    '',
    b('   Step by step:'),
    '   1. Open  System Settings',
    '        > Privacy & Security',
    '        > Full Disk Access',
    `   2. Click "+" and add ${b(app)}`,
    '        (if it is already listed, turn its toggle ON)',
    `   3. Fully QUIT and reopen ${b(app)} (Cmd+Q — not just closing the window)`,
    '   4. Re-run:  ' + b('npx opencard-export'),
    '',
    dim('   This tool only reads locally and uploads nothing.'),
  ];
  if (extraEnoentNote) {
    lines.push('', y('   Or: no Wallet passes exist yet on this Mac.'));
  }
  lines.push('');
  process.stderr.write(lines.join('\n') + '\n');
}

// ── transient progress ("spinner") ───────────────────────────────────────────
// Node built-ins only. Animates via \r on a TTY; degrades to a single plain
// line otherwise (or in --json mode). Written to stderr so stdout stays clean.
class Spinner {
  constructor(stream, { animated }) {
    this.stream = stream;
    this.animated = animated;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.frame = 0;
    this.timer = null;
    this.text = '';
  }
  start(text) {
    this.text = text;
    if (!this.animated) {
      this.stream.write(text + '\n');
      return;
    }
    this.#render();
    this.timer = setInterval(() => this.#render(), 80);
    if (this.timer.unref) this.timer.unref();
  }
  #render() {
    const f = this.frames[this.frame++ % this.frames.length];
    this.stream.write('\r\x1b[2K' + f + ' ' + this.text);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.stream.write('\r\x1b[2K');
    }
  }
}

// ── remote DB ────────────────────────────────────────────────────────────
async function fetchDb() {
  // Local override (tests / offline mirrors): read a JSON export from disk.
  const local = process.env.OPENCARD_DB_FILE;
  if (local) {
    try {
      const data = JSON.parse(await fs.readFile(local, 'utf-8'));
      if (Array.isArray(data)) return { cards: data, source: `file:${local}` };
    } catch {
      // fall through to network
    }
  }
  for (const url of DB_URLS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'opencard-export' },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) return { cards: data, source: url };
    } catch {
      // try next
    }
  }
  return null;
}

// ── helpers ────────────────────────────────────────────────────────────────
function slugify(name) {
  return (
    String(name || '')
      .replace(/[™®©]/g, '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'card'
  );
}

async function isOpencardRepo(dir) {
  if (!dir) return false;
  try {
    await fs.access(path.join(dir, 'schema.json'));
    await fs.access(path.join(dir, 'images'));
    await fs.access(path.join(dir, 'data'));
    return true;
  } catch {
    return false;
  }
}

/** One of 'has-art' | 'needs-art' | 'not-in-db'. */
function imageStateCode(match) {
  if (!match) return 'not-in-db';
  const img = match.card.image;
  if (img && (img.url || img.local_path)) return 'has-art';
  return 'needs-art';
}

function plural(n, singular, pluralForm) {
  return n === 1 ? singular : pluralForm;
}

/**
 * Resolve a card's on-disk data path within a checkout: data/{country}/{slug}.json
 * where id === `{country}-{slug}`.
 */
function dataCardPath(repoRoot, card) {
  const country = card.country || String(card.id).slice(0, 2);
  const slug = String(card.id).startsWith(country + '-')
    ? String(card.id).slice(country.length + 1)
    : String(card.id);
  return path.join(repoRoot, 'data', country, `${slug}.json`);
}

/**
 * Write a provenance block into a checkout's card JSON. Reads + JSON.parses the
 * existing file (refusing if it does not exist), sets image.provenance (and
 * image.local_path when absent, so the card stays validation-coherent), and
 * re-serializes with 2-space indent + a trailing newline. Never touches any
 * other field.
 * @returns {Promise<{written:true, path:string}>}
 */
async function writeProvenanceToRepo(repoRoot, card, provenance) {
  const file = dataCardPath(repoRoot, card);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new Error(
        `card JSON not found at ${path.relative(repoRoot, file)} (refusing to create it)`,
      );
    }
    throw e;
  }
  const parsed = JSON.parse(raw);
  const image = parsed.image && typeof parsed.image === 'object' ? parsed.image : {};
  image.provenance = provenance;
  if (image.local_path == null) {
    image.local_path = `images/${card.id}.png`;
  }
  parsed.image = image;
  await fs.writeFile(file, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  return { written: true, path: file };
}

// ── main ────────────────────────────────────────────────────────────────
async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof ArgError) {
      process.stderr.write(err.message + '\n');
      return 2;
    }
    throw err;
  }
  if (args.color === false) process.env.NO_COLOR = process.env.NO_COLOR || '1';
  const color = args.color === false ? false : colorEnabled();
  const c = (code, s) => (color ? code + s + ANSI.reset : s);
  const width =
    process.stdout.isTTY && process.stdout.columns
      ? Math.min(process.stdout.columns, 100)
      : 72;

  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.version) {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }

  // macOS-only guard (skipped when a passes dir is supplied for testing).
  if (process.platform !== 'darwin' && !args.passesDir) {
    process.stderr.write(
      'opencard-export is macOS-only — Apple Wallet stores cards locally on a Mac.\n' +
        `(detected platform: ${process.platform})\n`,
    );
    return 1;
  }

  // Header (single source of truth for the version: package.json).
  if (!args.json) {
    process.stdout.write('\n' + c(ANSI.bold, `opencard-export v${readVersion()}`) + '\n');
    process.stdout.write(c(ANSI.dim, `OpenCard DB · ${REPO_SLUG}`) + '\n\n');
  }

  const passesDir = args.passesDir || defaultCardsDir();
  const spinnerAnimated = process.stderr.isTTY && !args.json;
  const spinner = new Spinner(process.stderr, { animated: spinnerAnimated });

  // Permission preflight.
  let records;
  spinner.start('Scanning Apple Wallet…');
  try {
    records = await scanCards(passesDir);
    spinner.stop();
  } catch (err) {
    spinner.stop();
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
      printFdaGuide(process.env);
      return 2;
    }
    if (err && err.code === 'ENOENT') {
      // Distinguish "sandbox hides it" from "genuinely no passes yet".
      let parentReadable = true;
      try {
        await fs.readdir(path.dirname(passesDir));
      } catch (e2) {
        if (e2 && (e2.code === 'EACCES' || e2.code === 'EPERM'))
          parentReadable = false;
      }
      if (!parentReadable) {
        printFdaGuide(process.env);
        return 2;
      }
      // Parent readable but Cards missing -> no passes on this Mac.
      if (args.json) {
        process.stdout.write(
          JSON.stringify(
            {
              walletCards: [],
              ignoredNonPayment: 0,
              summary: { totalPasses: 0, paymentCards: 0 },
              note: 'no-wallet-cards',
            },
            null,
            2,
          ) + '\n',
        );
      } else {
        process.stdout.write(
          'No Apple Wallet cards directory on this Mac (no passes added yet?).\n',
        );
      }
      return 0;
    }
    throw err;
  }

  const payment = records.filter((r) => r.kind === 'payment');
  const others = records.filter((r) => r.kind !== 'payment');

  // Remote DB compare (unless disabled / offline).
  let db = null;
  let remoteNote = null;
  if (!args.noRemote) {
    spinner.start('Fetching OpenCard DB…');
    db = await fetchDb();
    spinner.stop();
    if (!db) remoteNote = 'offline';
  } else {
    remoteNote = 'skipped';
  }

  // Match payment cards to DB. For every card with an extractable art asset we
  // also hash the local Apple Pay PNG (and read its dimensions) so we can place
  // matched cards on the graduation ladder and, on --export, emit provenance.
  const rows = [];
  for (const p of payment) {
    let localSha = null;
    let pngDims = null;
    if (p.exportable && p.artAsset) {
      try {
        const buf = await fs.readFile(path.join(p.bundleDir, p.artAsset));
        localSha = sha256(buf);
        pngDims = parsePngDimensions(buf);
      } catch {
        // unreadable art asset — leave localSha/pngDims null
      }
    }
    const match = db ? matchCard({ name: p.name, issuer: p.issuer }, db.cards) : null;
    const stateCode = imageStateCode(match);
    const meter = match ? completenessMeter(match.card) : null;
    const art = match ? artStatus(match.card, localSha) : null;
    rows.push({ rec: p, match, stateCode, meter, localSha, pngDims, art });
  }

  // ── export ────────────────────────────────────────────────────────────
  const exportResults = [];
  if (args.export) {
    // Resolve target dir; prefer an opencard-db checkout's images/ when found.
    let targetDir = args.exportDir;
    let repoRoot = null;
    if (args.repo && (await isOpencardRepo(args.repo))) {
      repoRoot = args.repo;
      targetDir = path.join(args.repo, 'images');
    } else if (!targetDir) {
      const cwd = process.cwd();
      if (await isOpencardRepo(cwd)) {
        repoRoot = cwd;
        targetDir = path.join(cwd, 'images');
      } else {
        targetDir = '.';
      }
    }
    await fs.mkdir(targetDir, { recursive: true });

    for (const row of rows) {
      const { rec, match } = row;
      if (!rec.exportable || !rec.artAsset) {
        exportResults.push({
          name: rec.name,
          exported: false,
          reason: 'no extractable card-art asset (secure element)',
        });
        continue;
      }
      const baseName = match ? match.card.id : slugify(rec.name);
      const destName = `${baseName}.png`;
      const dest = path.join(targetDir, destName);
      const src = path.join(rec.bundleDir, rec.artAsset);
      try {
        await fs.copyFile(src, dest);
        // Provenance block (only meaningful for a matched card: it anchors the
        // sha into the DB card's art lineage).
        let provenance = null;
        if (match && row.localSha) {
          provenance = buildProvenanceBlock({
            sha256: row.localSha,
            width: row.pngDims ? row.pngDims.width : null,
            height: row.pngDims ? row.pngDims.height : null,
            exportedAt: today(),
          });
        }
        const result = {
          name: rec.name,
          issuer: rec.issuer,
          dest,
          exported: true,
          matchedId: match ? match.card.id : null,
          localSha: row.localSha,
          provenance,
        };
        // --repo mode: write the provenance block straight into the matched
        // card's JSON (surgical: only image.provenance, plus image.local_path
        // when absent so the card stays validation-coherent — provenance
        // describes a committed art file). Refuse if the card JSON is missing.
        if (repoRoot && match && provenance) {
          try {
            result.repoWrite = await writeProvenanceToRepo(
              repoRoot,
              match.card,
              provenance,
            );
          } catch (e) {
            result.repoWrite = { written: false, reason: e.message };
          }
        }
        exportResults.push(result);
      } catch (e) {
        exportResults.push({
          name: rec.name,
          exported: false,
          reason: `copy failed: ${e.code || e.message}`,
        });
      }
    }
  }

  // ── JSON output ───────────────────────────────────────────────────────────
  if (args.json) {
    const out = {
      walletCards: rows.map((r) => ({
        name: r.rec.name,
        issuer: r.rec.issuer,
        kind: r.rec.kind,
        exportable: r.rec.exportable,
        matchedId: r.match ? r.match.card.id : null,
        matchScore: r.match ? Number(r.match.score.toFixed(3)) : null,
        imageState: r.stateCode,
        art_status: r.art,
        local_sha256: r.localSha,
        completeness: r.meter
          ? {
              filled: r.meter.filled,
              total: r.meter.total,
              fields: Object.fromEntries(r.meter.fields.map((f) => [f.key, f.ok])),
            }
          : null,
        // NOTE: suffix is intentionally omitted from JSON (local-only).
      })),
      ignoredNonPayment: others.length,
      summary: {
        totalPasses: records.length,
        paymentCards: payment.length,
        matched: rows.filter((r) => r.match).length,
        complete: rows.filter((r) => r.stateCode === 'has-art').length,
        missingArt: rows.filter((r) => r.stateCode === 'needs-art').length,
        notInDb: rows.filter((r) => r.stateCode === 'not-in-db').length,
        graduated: rows.filter((r) => r.art === 'graduated').length,
        newDesign: rows.filter((r) => r.art === 'new-design').length,
        upgradeable: rows.filter((r) => r.art === 'upgradeable').length,
        exportable: payment.filter((p) => p.exportable).length,
      },
      remote: { note: remoteNote, source: db ? db.source : null },
      export: args.export ? exportResults : undefined,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  }

  // ── human output: empty state ───────────────────────────────────────────
  const ignoredLine =
    others.length > 0
      ? c(
          ANSI.dim,
          `Ignored ${others.length} non-payment ${plural(
            others.length,
            'pass',
            'passes',
          )} (loyalty cards, tickets, boarding passes).`,
        )
      : null;

  if (payment.length === 0) {
    process.stdout.write('No Apple Pay payment cards found in Wallet.\n');
    if (ignoredLine) process.stdout.write(ignoredLine + '\n');
    process.stdout.write(
      c(
        ANSI.dim,
        'opencard-export contributes Apple Pay card art to OpenCard DB — add a card to\n' +
          'Apple Pay and re-run to help fill in a card face.',
      ) + '\n',
    );
    process.stdout.write('\n' + c(ANSI.dim, attributionNotice()) + '\n');
    return 0;
  }

  // ── human output: dot list ────────────────────────────────────────────────
  for (const r of rows) {
    process.stdout.write(
      renderCardEntry(
        {
          name: r.rec.name,
          issuer: r.rec.issuer,
          stateCode: r.stateCode,
          matchedId: r.match ? r.match.card.id : null,
          fields: r.meter ? r.meter.fields : null,
          artStatus: r.art,
        },
        { color, width },
      ) + '\n',
    );
  }

  // ── summary (footer-style, colored segments) ───────────────────────────────
  // The old binary "complete" splits into the three graduation tiers.
  const nGraduated = rows.filter((r) => r.art === 'graduated').length;
  const nNewDesign = rows.filter((r) => r.art === 'new-design').length;
  const nUpgradeable = rows.filter((r) => r.art === 'upgradeable').length;
  const nMissing = rows.filter((r) => r.stateCode === 'needs-art').length;
  const nNotInDb = rows.filter((r) => r.stateCode === 'not-in-db').length;
  const sep = c(ANSI.dim, ' · ');
  const summary = [
    c(ANSI.bold, `${payment.length} payment ${plural(payment.length, 'card', 'cards')}`),
    c(ANSI.green, `${nGraduated} graduated`),
    c(ANSI.cyan, `${nNewDesign} new-design?`),
    c(ANSI.yellow, `${nUpgradeable} upgradeable`),
    c(ANSI.yellow, `${nMissing} missing art`),
    c(ANSI.red, `${nNotInDb} not in DB`),
  ].join(sep);
  process.stdout.write('\n' + summary + '\n');
  if (ignoredLine) process.stdout.write(ignoredLine + '\n');

  // ── next steps ──────────────────────────────────────────────────────────
  const hasNeedsArt = nMissing > 0;
  const hasNotInDb = nNotInDb > 0;
  const hasNewDesign = nNewDesign > 0;
  const hasUpgradeable = nUpgradeable > 0;
  process.stdout.write('\n' + c(ANSI.bold, 'Next steps:') + '\n');

  if (remoteNote === 'offline') {
    process.stdout.write(
      c(ANSI.yellow, '  • Offline: DB comparison was skipped. Re-run when connected.') + '\n',
    );
  } else if (remoteNote === 'skipped') {
    process.stdout.write(
      c(ANSI.dim, '  • DB comparison skipped via --no-remote.') + '\n',
    );
  }

  if (hasUpgradeable) {
    process.stdout.write(
      c(ANSI.yellow, '  • Upgradeable') +
        ' — your Apple Pay export beats the current issuer-site art.\n' +
        c(ANSI.dim, '    Run ') +
        c(ANSI.bold, 'npx opencard-export --export') +
        c(ANSI.dim, ' and open a PR.') +
        '\n',
    );
  }
  if (hasNewDesign) {
    process.stdout.write(
      c(ANSI.cyan, '  • New design?') +
        " — your export differs from the DB's Apple Pay art; banks refresh designs.\n" +
        c(
          ANSI.dim,
          "    Submit if your card looks newer (or if it's an @3x variant, maintainers\n" +
            '    can add it to alternate_sha256).',
        ) +
        '\n',
    );
  }
  if (hasNeedsArt) {
    process.stdout.write(
      c(ANSI.yellow, '  • Missing art') +
        ' — run ' +
        c(ANSI.bold, 'npx opencard-export --export') +
        ', then add ' +
        c(ANSI.cyan, 'images/<card-id>.png') +
        ' in a PR\n' +
        c(ANSI.dim, '    (CI converts it to lossless WebP).') +
        '\n',
    );
  }
  if (hasNotInDb) {
    process.stdout.write(
      c(ANSI.red, '  • Not in OpenCard DB') +
        ' — open the Request-a-card form:\n' +
        '    ' +
        c(ANSI.cyan, ISSUE_FORM_URL) +
        '\n',
    );
  }
  if (remoteNote == null && !hasNeedsArt && !hasNotInDb && !hasNewDesign && !hasUpgradeable) {
    process.stdout.write(
      c(ANSI.green, '  • All matched cards are graduated — nothing to contribute right now. Thanks for checking!') +
        '\n',
    );
  }

  // ── export results (printed after the report) ─────────────────────────────
  if (args.export) {
    process.stdout.write('\n');
    for (const r of exportResults) {
      if (r.exported) {
        process.stdout.write(
          c(ANSI.bold, `Exported: ${path.basename(r.dest)}`) +
            '\n' +
            c(ANSI.dim, `  → ${r.dest}`) +
            '\n' +
            c(ANSI.dim, `  ${attributionLine(r.issuer)}`) +
            '\n',
        );
        if (r.localSha) {
          process.stdout.write(c(ANSI.dim, `  sha256: ${r.localSha}`) + '\n');
        }
        // Paste-ready provenance block for a matched card.
        if (r.provenance) {
          const snippet = provenanceSnippet(r.provenance)
            .split('\n')
            .map((l) => '    ' + l)
            .join('\n');
          process.stdout.write(
            c(ANSI.dim, '  Paste into the card\'s "image" object:') +
              '\n' +
              c(ANSI.cyan, snippet) +
              '\n',
          );
        }
        // --repo write outcome.
        if (r.repoWrite) {
          if (r.repoWrite.written) {
            process.stdout.write(
              c(ANSI.green, `  ✓ wrote image.provenance into ${path.basename(r.repoWrite.path)}`) +
                '\n',
            );
          } else {
            process.stdout.write(
              c(ANSI.yellow, `  ⚠ provenance not written: ${r.repoWrite.reason}`) + '\n',
            );
          }
        }
      } else {
        process.stdout.write(c(ANSI.dim, `Skipped: ${r.name} — ${r.reason}`) + '\n');
      }
    }
    const intoImages = exportResults.some(
      (r) => r.exported && path.basename(path.dirname(r.dest)) === 'images',
    );
    const wroteProvenance = exportResults.some((r) => r.repoWrite && r.repoWrite.written);
    if (intoImages) {
      const next = wroteProvenance
        ? 'Next: review the image.provenance blocks written above, then open a PR (CI verifies the sha chain and converts to lossless WebP).'
        : "Next: set each card's image.local_path (CI converts to lossless WebP) and open a PR.";
      process.stdout.write(
        '\n' +
          c(ANSI.dim, 'Detected an OpenCard DB checkout — wrote into images/.') +
          '\n' +
          c(ANSI.dim, next) +
          '\n',
      );
    }
  }

  // Attribution footer (always, once; English, dimmed).
  process.stdout.write('\n' + c(ANSI.dim, attributionNotice()) + '\n');

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      'opencard-export error: ' + (err && err.stack ? err.stack : String(err)) + '\n',
    );
    process.exit(1);
  });
