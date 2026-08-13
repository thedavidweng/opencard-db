#!/usr/bin/env node
// opencard-export — scan Apple Wallet payment cards, compare against the live
// OpenCard DB, and (optionally) export digital card art for contribution.
//
// Zero dependencies, plain ESM. Everything runs locally; nothing is uploaded.

import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnSync } from 'node:child_process';

import { scanCards, defaultCardsDir } from '../lib/passes.mjs';
import { matchCard } from '../lib/match.mjs';
import {
  renderCardTable,
  completenessMeter,
  colorEnabled,
  ANSI,
} from '../lib/render.mjs';
import { attributionLine, attributionNotice } from '../lib/attribution.mjs';
import {
  sha256,
  parsePngDimensions,
  artFacts,
  buildProvenanceBlock,
  provenanceSnippet,
  today,
} from '../lib/art.mjs';
import { replaceImageBlock } from '../lib/json-edit.mjs';
import {
  isOpencardRepo,
  findOpencardRepo,
  loadRepoCards,
} from '../lib/catalog.mjs';
import { buildArtPr, nextStepCommands } from '../lib/pr.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    pr: false,
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
      case '--pr':
        args.pr = true;
        break;
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
  process.stdout.write(
    `Scan Apple Wallet payment cards and contribute card art to OpenCard DB.

USAGE
  npx opencard-export [flags]

The default run scans Wallet, compares against the live database, and writes
nothing.

FLAGS
  --export [dir]    write card art PNGs (default: images/ in a checkout, else .)
  --repo <path>     an OpenCard DB checkout; also writes provenance into card JSON
  --pr              after --export --repo, commit and open a GitHub PR (needs gh)
  --json            machine-readable output
  --no-remote       skip the remote export; a checkout still compares against data/
  --passes-dir <p>  override the Wallet passes directory
  --no-color        disable color (NO_COLOR is also honored)
  -h, --help        show help
  -v, --version     show version

Runs locally and uploads nothing; reads card names and art only, never card
numbers or tokens.
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

function printFdaGuide(env = process.env) {
  const app = terminalAppName(env);
  const color = colorEnabled(env);
  const b = (s) => (color ? ANSI.bold + s + ANSI.reset : s);
  const dim = (s) => (color ? ANSI.dim + s + ANSI.reset : s);
  const lines = [
    'error: cannot read Apple Wallet passes (~/Library/Passes)',
    '',
    `${b(app)} needs macOS Full Disk Access to read Wallet data:`,
    '',
    '  1. Open System Settings > Privacy & Security > Full Disk Access',
    `  2. Add ${b(app)}, or turn its existing toggle on`,
    `  3. Quit ${b(app)} fully (Cmd+Q) and reopen it`,
    `  4. Run ${b('npx opencard-export')} again`,
    '',
    dim('Everything runs locally; nothing is uploaded.'),
    '',
  ];
  process.stderr.write(lines.join('\n'));
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
  const image = parsed.image && typeof parsed.image === 'object' ? { ...parsed.image } : {};
  image.provenance = provenance;
  if (image.local_path == null) {
    image.local_path = `images/${card.id}.png`;
  }
  const wantAttr = attributionLine(card.issuer || parsed.issuer);
  if (!image.attribution || !/apple pay/i.test(String(image.attribution))) {
    image.attribution = wantAttr;
  }
  const next = replaceImageBlock(raw, image);
  await fs.writeFile(file, next.endsWith('\n') ? next : next + '\n', 'utf-8');
  return { written: true, path: file };
}

function runGit(repoRoot, args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function openArtPr({ repoRoot, branch, files, title, bodyFile }) {
  const gitDir = runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  if (gitDir.status !== 0 || String(gitDir.stdout).trim() !== 'true') {
    return { ok: false, message: `${repoRoot} is not a git work tree` };
  }
  const head = runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const current = String(head.stdout || '').trim();
  if (current === 'main' || current === 'master') {
    const co = runGit(repoRoot, ['checkout', '-b', branch]);
    if (co.status !== 0) {
      return {
        ok: false,
        message: `could not create branch ${branch}: ${(co.stderr || co.stdout || '').trim()}`,
      };
    }
  }
  const add = runGit(repoRoot, ['add', '--', ...files]);
  if (add.status !== 0) {
    return { ok: false, message: `git add failed: ${(add.stderr || '').trim()}` };
  }
  const commit = runGit(repoRoot, ['commit', '-m', title]);
  if (commit.status !== 0) {
    const msg = `${commit.stderr || ''} ${commit.stdout || ''}`;
    if (!/nothing to commit/i.test(msg)) {
      return { ok: false, message: `git commit failed: ${msg.trim()}` };
    }
  }
  const push = runGit(repoRoot, ['push', '-u', 'origin', 'HEAD']);
  if (push.status !== 0) {
    return {
      ok: false,
      message: `git push failed: ${(push.stderr || push.stdout || '').trim()}`,
    };
  }
  const pr = spawnSync(
    'gh',
    ['pr', 'create', '--title', title, '--body-file', bodyFile],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (pr.status !== 0) {
    return {
      ok: false,
      message: `gh pr create failed: ${(pr.stderr || pr.stdout || '').trim()}`,
    };
  }
  return { ok: true, message: String(pr.stdout || '').trim() || 'PR opened' };
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

  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.version) {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }
  if (args.pr && !args.export) {
    process.stderr.write('error: --pr requires --export (and a checkout via --repo or cwd)\n');
    return 2;
  }

  // macOS-only guard (skipped when a passes dir is supplied for testing).
  if (process.platform !== 'darwin' && !args.passesDir) {
    process.stderr.write(
      'opencard-export is macOS-only: Apple Wallet stores cards locally on a Mac.\n' +
        `(detected platform: ${process.platform})\n`,
    );
    return 1;
  }

  const passesDir = args.passesDir || defaultCardsDir();
  const spinnerAnimated = process.stderr.isTTY && !args.json;
  const spinner = new Spinner(process.stderr, { animated: spinnerAnimated });

  // A checkout is the source of truth for match + lineage (includes art
  // just written). Detect --repo or walk up from cwd so `npx` from a
  // subdirectory still finds the repo.
  let repoRoot = null;
  if (args.repo) {
    const resolved = path.resolve(args.repo);
    if (await isOpencardRepo(resolved)) repoRoot = resolved;
    else {
      process.stderr.write(
        `error: --repo ${args.repo} is not an OpenCard DB checkout (need schema.json, data/, images/)\n`,
      );
      return 2;
    }
  } else {
    repoRoot = await findOpencardRepo(process.cwd());
  }

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

  // Local data/ wins for ids it has (so a just-written provenance block is
  // visible). The public export / OPENCARD_DB_FILE fills any ids the
  // checkout doesn't contain (tests, partial trees).
  let db = null;
  let remoteNote = null;
  let localCards = [];
  if (repoRoot) {
    spinner.start('Reading local OpenCard DB…');
    localCards = await loadRepoCards(repoRoot);
    spinner.stop();
  }
  let remote = null;
  if (!args.noRemote || process.env.OPENCARD_DB_FILE) {
    if (!process.env.OPENCARD_DB_FILE) spinner.start('Fetching OpenCard DB…');
    remote = await fetchDb();
    if (!process.env.OPENCARD_DB_FILE) spinner.stop();
  }
  if (localCards.length || (remote && remote.cards.length)) {
    const byId = new Map();
    if (remote) {
      for (const c of remote.cards) if (c && c.id) byId.set(c.id, c);
    }
    const hasArt = (img) =>
      !!(img && (img.url || img.local_path || img.provenance));
    for (const local of localCards) {
      if (!local || !local.id) continue;
      const prev = byId.get(local.id);
      if (!prev) {
        byId.set(local.id, local);
        continue;
      }
      const merged = { ...prev, ...local };
      if (!hasArt(local.image) && prev.image) merged.image = prev.image;
      byId.set(local.id, merged);
    }
    db = {
      cards: [...byId.values()],
      source: localCards.length ? `repo:${repoRoot}` : remote.source,
    };
    remoteNote = localCards.length ? 'repo' : remote ? null : 'offline';
  } else if (args.noRemote && !process.env.OPENCARD_DB_FILE) {
    remoteNote = 'skipped';
  } else {
    remoteNote = 'offline';
  }

  // Match payment cards to DB. For every card with an extractable art asset we
  // also hash the local Apple Pay PNG (and read its dimensions) so we can place
  // tell whether the database already has each matched card's art and, on
  // --export, emit provenance.
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
    const meter = match ? completenessMeter(match.card) : null;
    const art = match ? artFacts(match.card, localSha) : null;
    // The three states an outsider needs: the database has no entry for this
    // card, it has the entry but not this card face, or it has both. Null when
    // the database was not consulted (offline / --no-remote): unknown, not
    // "not in database".
    const status = !db
      ? null
      : !match
        ? 'not-in-database'
        : art && art.sameArt
          ? 'up-to-date'
          : 'art-wanted';
    rows.push({ rec: p, match, status, meter, localSha, pngDims, art });
  }

  // ── export ────────────────────────────────────────────────────────────
  const exportResults = [];
  if (args.export) {
    // PNGs that will go into a PR must land in images/ so CI can convert
    // them. An extra --export dir is a convenience copy, not a substitute.
    const imagesDir = repoRoot ? path.join(repoRoot, 'images') : null;
    let targetDir = imagesDir || args.exportDir || '.';
    const extraDir =
      args.exportDir && imagesDir && path.resolve(args.exportDir) !== path.resolve(imagesDir)
        ? args.exportDir
        : null;
    await fs.mkdir(targetDir, { recursive: true });
    if (extraDir) await fs.mkdir(extraDir, { recursive: true });

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
        if (extraDir) {
          await fs.copyFile(src, path.join(extraDir, destName));
        }
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
          sameArt: !!(row.art && row.art.sameArt),
          localSha: row.localSha,
          provenance,
        };
        // --repo mode: write the provenance block straight into the matched
        // card's JSON (surgical: only image.provenance, plus image.local_path
        // when absent so the card stays validation-coherent — provenance
        // describes a committed art file). Refuse if the card JSON is missing.
        // Skipped when the database already carries this exact art: rewriting
        // identical provenance contributes nothing and could clobber an
        // alternate-sha anchor.
        if (repoRoot && match && provenance && !(row.art && row.art.sameArt)) {
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

  let contribution = null;
  if (args.export && repoRoot && db) {
    const contributed = exportResults.filter(
      (r) => r.exported && r.matchedId && r.repoWrite && r.repoWrite.written && !r.sameArt,
    );
    if (contributed.length > 0) {
      const prCards = contributed.map(
        (r) => db.cards.find((c) => c.id === r.matchedId) || { id: r.matchedId },
      );
      const spec = buildArtPr(prCards, today());
      const files = [];
      for (const r of contributed) {
        files.push(path.relative(repoRoot, r.dest));
        if (r.repoWrite && r.repoWrite.path) {
          files.push(path.relative(repoRoot, r.repoWrite.path));
        }
      }
      const branch =
        spec.kind === 'card-update' ? `card-art/${prCards[0].id}` : 'card-art/apple-pay';
      const bodyFile = path.join(repoRoot, '.git', 'opencard-export-pr.md');
      try {
        await fs.mkdir(path.dirname(bodyFile), { recursive: true });
        await fs.writeFile(bodyFile, spec.body, 'utf-8');
      } catch {
        // tests / missing .git
      }
      contribution = {
        spec,
        files: [...new Set(files)],
        branch,
        bodyFile,
        cmds: nextStepCommands({
          branch,
          files: [...new Set(files)],
          title: spec.title,
          bodyFile: path.relative(repoRoot, bodyFile),
        }),
      };
    }
  }

  if (args.pr) {
    if (!contribution) {
      process.stderr.write(
        'error: --pr found nothing to contribute (need a checkout, a DB match, and new art)\n',
      );
      return 2;
    }
    const prResult = openArtPr({
      repoRoot,
      branch: contribution.branch,
      files: contribution.files,
      title: contribution.spec.title,
      bodyFile: contribution.bodyFile,
    });
    if (!prResult.ok) {
      process.stderr.write(`error: --pr failed: ${prResult.message}\n`);
      return 2;
    }
    contribution.prUrl = prResult.message;
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
        status: r.status,
        db_art: r.art ? r.art.dbArt : null,
        same_art: r.art ? r.art.sameArt : null,
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
        upToDate: rows.filter((r) => r.status === 'up-to-date').length,
        artWanted: rows.filter((r) => r.status === 'art-wanted').length,
        notInDb: rows.filter((r) => r.status === 'not-in-database').length,
        exportable: payment.filter((p) => p.exportable).length,
      },
      remote: { note: remoteNote, source: db ? db.source : null },
      export: args.export ? exportResults : undefined,
      contribution: contribution
        ? {
            title: contribution.spec.title,
            branch: contribution.branch,
            files: contribution.files,
            cmds: contribution.cmds,
            prUrl: contribution.prUrl || null,
          }
        : undefined,
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
    process.stdout.write('No Apple Pay payment cards in Wallet.\n');
    if (ignoredLine) process.stdout.write(ignoredLine + '\n');
    process.stdout.write(
      c(ANSI.dim, 'Add a card to Apple Pay and rerun to contribute its art to OpenCard DB.') +
        '\n',
    );
    return 0;
  }

  // ── human output: table ─────────────────────────────────────────────────
  process.stdout.write(
    renderCardTable(
      rows.map((r) => ({
        name: r.rec.name,
        issuer: r.rec.issuer,
        matchedId: r.match ? r.match.card.id : null,
        filled: r.meter ? r.meter.filled : null,
        total: r.meter ? r.meter.total : null,
        status: r.status,
      })),
      { color },
    ) + '\n',
  );

  // ── summary ───────────────────────────────────────────────────────────────
  const nUpToDate = rows.filter((r) => r.status === 'up-to-date').length;
  const nArtWanted = rows.filter((r) => r.status === 'art-wanted').length;
  const nNotInDb = rows.filter((r) => r.status === 'not-in-database').length;
  const counts = [];
  if (nArtWanted) counts.push(`${nArtWanted} art wanted`);
  if (nNotInDb) counts.push(`${nNotInDb} not in database`);
  if (nUpToDate) counts.push(`${nUpToDate} up to date`);
  const head = `${payment.length} payment ${plural(payment.length, 'card', 'cards')}`;
  process.stdout.write(
    '\n' + head + (counts.length && db ? `: ${counts.join(', ')}` : '') + '\n',
  );
  if (ignoredLine) process.stdout.write(ignoredLine + '\n');

  if (remoteNote === 'offline') {
    process.stderr.write(
      'note: OpenCard DB unreachable; match columns unavailable\n',
    );
  } else if (remoteNote === 'skipped') {
    process.stderr.write('note: database comparison skipped (--no-remote)\n');
  }

  // ── hints (only when actionable, never on offline runs where match state
  //    is unknown, and not while already exporting) ──────────────────────────
  if (!args.export && db) {
    const nExportable = rows.filter(
      (r) => r.rec.exportable && r.status === 'art-wanted',
    ).length;
    const hints = [];
    if (nExportable > 0) {
      hints.push(
        `To contribute card art (${nExportable} ${plural(nExportable, 'card', 'cards')}), run: npx opencard-export --export`,
      );
    }
    if (nNotInDb > 0) {
      hints.push(`To request a missing card: ${ISSUE_FORM_URL}`);
    }
    if (hints.length) {
      process.stdout.write(
        '\n' + hints.map((h) => c(ANSI.dim, h)).join('\n') + '\n',
      );
    }
  }

  // ── export results (printed after the report) ─────────────────────────────
  if (args.export) {
    process.stdout.write('\n');
    for (const r of exportResults) {
      if (!r.exported) {
        process.stdout.write(c(ANSI.dim, `- skipped ${r.name}: ${r.reason}`) + '\n');
        continue;
      }
      process.stdout.write(c(ANSI.green, '✓') + ` ${path.basename(r.dest)}` + '\n');
      if (r.sameArt) {
        process.stdout.write(
          c(ANSI.dim, '  the database already has this exact art; nothing new to contribute') + '\n',
        );
        continue;
      }
      if (db && !r.matchedId) {
        process.stdout.write(
          c(ANSI.dim, `  not in the database; request the card first: ${ISSUE_FORM_URL}`) +
            '\n',
        );
      }
      if (r.repoWrite) {
        if (r.repoWrite.written) {
          process.stdout.write(
            c(ANSI.dim, `  provenance written to ${r.repoWrite.path}`) + '\n',
          );
        } else {
          process.stdout.write(
            c(ANSI.yellow, `  provenance not written: ${r.repoWrite.reason}`) + '\n',
          );
        }
      } else {
        // No checkout to write into: print what a PR needs, paste-ready.
        process.stdout.write(
          c(ANSI.dim, `  attribution: ${attributionLine(r.issuer)}`) + '\n',
        );
        if (r.localSha) {
          process.stdout.write(c(ANSI.dim, `  sha256: ${r.localSha}`) + '\n');
        }
        if (r.provenance) {
          const snippet = provenanceSnippet(r.provenance)
            .split('\n')
            .map((l) => '    ' + l)
            .join('\n');
          process.stdout.write(
            c(ANSI.dim, '  paste into the card\'s "image" object:') +
              '\n' +
              c(ANSI.dim, snippet) +
              '\n',
          );
        }
      }
    }

    const nExported = exportResults.filter((r) => r.exported).length;
    const destDir = exportResults.find((r) => r.exported)?.dest;
    const summaryBits = [
      `Exported ${nExported} ${plural(nExported, 'file', 'files')}` +
        (destDir ? ` to ${path.dirname(destDir)}` : ''),
    ];
    if (nExported > 0) {
      summaryBits.push(
        'CI verifies the sha chain and converts the PNG to lossless WebP.',
      );
      summaryBits.push(attributionNotice());
    }
    process.stdout.write(
      '\n' + summaryBits.map((l) => c(ANSI.dim, l)).join('\n') + '\n',
    );

    if (contribution) {
      process.stdout.write(
        '\n' +
          c(ANSI.dim, 'Next — contribute this art:') +
          '\n' +
          contribution.cmds.map((line) => c(ANSI.dim, '  ' + line)).join('\n') +
          '\n',
      );
      if (contribution.prUrl) {
        process.stdout.write(c(ANSI.green, '✓') + ` ${contribution.prUrl}\n`);
      } else {
        process.stdout.write(
          c(ANSI.dim, 'Or rerun with --pr to commit and open the PR (requires gh).') +
            '\n',
        );
      }
    }
  }

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
