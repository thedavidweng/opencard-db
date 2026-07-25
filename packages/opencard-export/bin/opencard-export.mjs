#!/usr/bin/env node
// opencard-export — scan Apple Wallet payment cards, compare against the live
// OpenCard DB, and (optionally) export digital card art for contribution.
//
// Zero dependencies, plain ESM. Everything runs locally; nothing is uploaded.

import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  scanCards,
  defaultCardsDir,
} from '../lib/passes.mjs';
import { matchCard } from '../lib/match.mjs';
import {
  renderTable,
  completenessMeter,
  colorEnabled,
  truncate,
  ANSI,
} from '../lib/table.mjs';
import { attributionLine, attributionNotice } from '../lib/attribution.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_URLS = [
  'https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@main/exports/cards-all.json',
  'https://raw.githubusercontent.com/thedavidweng/opencard-db/main/exports/cards-all.json',
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
function parseArgs(argv) {
  const args = {
    help: false,
    version: false,
    export: false,
    exportDir: null,
    json: false,
    noRemote: false,
    all: false,
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
      case '--all':
        args.all = true;
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
        // Ignore unknown flags gracefully.
        break;
    }
  }
  return args;
}

// ── help / version ────────────────────────────────────────────────────────
function printHelp() {
  const v = readVersion();
  process.stdout.write(
    `opencard-export v${v}
向 OpenCard DB 贡献 Apple Pay 卡面 / Contribute Apple Pay card art to OpenCard DB

用法 / Usage:
  npx opencard-export [command] [options]

默认 / Default: 扫描钱包支付卡并对照数据库生成报告（不写文件）
                scan Wallet payment cards + compare with the DB (no files written)

选项 / Options:
  --export [dir]   导出卡面到 dir（默认 ./）/ export card art to dir (default ./)
  --json           机器可读输出（无颜色）/ machine-readable output (no ANSI)
  --all            表格中包含非支付卡（仅信息，永不导出）
                   include non-payment passes as info rows (never exported)
  --no-remote      跳过数据库对照 / skip the live DB comparison
  --repo <path>    OpenCard DB 检出目录，导出直接写入其 images/
                   an opencard-db checkout; export writes straight into its images/
  --passes-dir <p> 覆盖钱包目录（高级/测试）/ override Wallet dir (advanced/testing)
  --no-color       禁用颜色 / disable color (also respects NO_COLOR)
  -h, --help       显示帮助 / show this help
  -v, --version    显示版本 / show version

隐私 / Privacy: 全部在本地运行，不上传任何内容；不会读取或输出卡号/令牌。
               Everything runs locally. Nothing is uploaded. No PANs/tokens are read.
卡面版权归发卡行所有 / Card art remains the issuing bank's copyright (see SECURITY.md).
`,
  );
}

// ── FDA guide (the single most important UX in the tool) ─────────────────────
function terminalAppName(env = process.env) {
  switch (env.TERM_PROGRAM) {
    case 'Apple_Terminal':
      return { en: 'Terminal', zh: '“终端” (Terminal)' };
    case 'iTerm.app':
      return { en: 'iTerm2', zh: 'iTerm2' };
    case 'vscode':
      return { en: 'Visual Studio Code', zh: 'Visual Studio Code' };
    case 'WarpTerminal':
      return { en: 'Warp', zh: 'Warp' };
    case 'Hyper':
      return { en: 'Hyper', zh: 'Hyper' };
    case 'Tabby':
      return { en: 'Tabby', zh: 'Tabby' };
    default:
      return { en: 'your terminal app', zh: '你正在使用的终端应用' };
  }
}

function printFdaGuide(env = process.env, extraEnoentNote = false) {
  const app = terminalAppName(env);
  const color = colorEnabled(env) && env.__NO_COLOR_FLAG !== '1';
  const b = (s) => (color ? ANSI.bold + s + ANSI.reset : s);
  const y = (s) => (color ? ANSI.yellow + s + ANSI.reset : s);
  const lines = [
    '',
    y('⚠  无法读取 Apple Wallet 卡片目录 / Cannot read your Apple Wallet cards'),
    '',
    `   需要为 ${b(app.zh)} 开启“完全磁盘访问权限”。`,
    `   ${app.en} needs macOS "Full Disk Access" to read ~/Library/Passes/.`,
    '',
    b('   分步操作 / Step by step:'),
    '   1. 打开“系统设置” / Open  System Settings',
    '        > Privacy & Security  (隐私与安全性)',
    '        > Full Disk Access    (完全磁盘访问权限)',
    `   2. 点击 “+”，添加 ${b(app.en)} / Click "+" and add ${b(app.en)}`,
    `        （若已在列表中，请把开关打开 / if already listed, turn its toggle ON）`,
    `   3. 完全退出并重新打开 ${b(app.en)}（务必彻底退出，不只是关窗口）`,
    `      Fully QUIT and reopen ${b(app.en)} (Cmd+Q — not just closing the window)`,
    '   4. 重新运行 / Re-run:  ' + b('npx opencard-export'),
    '',
    '   说明 / Note: 本工具只在本地读取，不上传任何内容。',
    '                This tool only reads locally and uploads nothing.',
  ];
  if (extraEnoentNote) {
    lines.push(
      '',
      y('   （也可能是此 Mac 尚未添加任何 Wallet 卡片 / Or: no Wallet passes exist yet on this Mac.）'),
    );
  }
  lines.push('');
  process.stderr.write(lines.join('\n') + '\n');
}

// ── remote DB ────────────────────────────────────────────────────────────
async function fetchDb() {
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

function imageState(match) {
  if (!match) return { code: 'not-in-db', label: '🔴 数据库未收录' };
  const img = match.card.image;
  if (img && (img.url || img.local_path))
    return { code: 'has-art', label: '✅ 已收录，已有卡面' };
  return { code: 'needs-art', label: '🟡 已收录，缺卡面' };
}

// ── main ────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.color === false) process.env.NO_COLOR = process.env.NO_COLOR || '1';
  const color = args.color === false ? false : colorEnabled();

  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.version) {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }

  // macOS-only guard.
  if (process.platform !== 'darwin') {
    process.stderr.write(
      'opencard-export 仅支持 macOS（Apple Wallet 卡片存储在本机）。\n' +
        'opencard-export is macOS-only — Apple Wallet stores cards locally on a Mac.\n' +
        `(detected platform: ${process.platform})\n`,
    );
    return 1;
  }

  const passesDir = args.passesDir || defaultCardsDir();

  // Permission preflight.
  let records;
  try {
    records = await scanCards(passesDir);
  } catch (err) {
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
            { walletCards: [], summary: { total: 0, payment: 0 }, note: 'no-wallet-cards' },
            null,
            2,
          ) + '\n',
        );
      } else {
        process.stdout.write(
          '未在此 Mac 上找到 Wallet 卡片目录（尚无任何卡片？）。\n' +
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
    db = await fetchDb();
    if (!db) remoteNote = 'offline';
  } else {
    remoteNote = 'skipped';
  }

  // Match payment cards to DB.
  const rows = [];
  for (const p of payment) {
    const match = db ? matchCard({ name: p.name, issuer: p.issuer }, db.cards) : null;
    const state = imageState(match);
    const meter = match ? completenessMeter(match.card) : null;
    rows.push({ rec: p, match, state, meter });
  }

  // ── export ────────────────────────────────────────────────────────────
  const exportResults = [];
  if (args.export) {
    // Resolve target dir; prefer an opencard-db checkout's images/ when found.
    let targetDir = args.exportDir;
    let intoImages = false;
    if (args.repo && (await isOpencardRepo(args.repo))) {
      targetDir = path.join(args.repo, 'images');
      intoImages = true;
    } else if (!targetDir) {
      const cwd = process.cwd();
      if (await isOpencardRepo(cwd)) {
        targetDir = path.join(cwd, 'images');
        intoImages = true;
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
        exportResults.push({
          name: rec.name,
          issuer: rec.issuer,
          dest,
          exported: true,
          matchedId: match ? match.card.id : null,
        });
      } catch (e) {
        exportResults.push({
          name: rec.name,
          exported: false,
          reason: `copy failed: ${e.code || e.message}`,
        });
      }
    }

    if (!args.json) {
      process.stdout.write('\n');
      for (const r of exportResults) {
        if (r.exported) {
          process.stdout.write(
            `导出 / Exported: ${path.basename(r.dest)}\n` +
              `  → ${r.dest}\n` +
              `  ${attributionLine(r.issuer)}\n`,
          );
        } else {
          process.stdout.write(`跳过 / Skipped: ${r.name} — ${r.reason}\n`);
        }
      }
      if (intoImages) {
        process.stdout.write(
          '\n检测到 OpenCard DB 检出，已写入 images/。/ Detected an OpenCard DB checkout — wrote into images/.\n' +
            '下一步：为每张卡设置 image.local_path（CI 会转成无损 WebP）并提交 PR。\n' +
            'Next: set each card\'s image.local_path (CI converts to lossless WebP) and open a PR.\n',
        );
      }
    }
  }

  // ── output ──────────────────────────────────────────────────────────────
  if (args.json) {
    const out = {
      walletCards: rows.map((r) => ({
        name: r.rec.name,
        issuer: r.rec.issuer,
        kind: r.rec.kind,
        exportable: r.rec.exportable,
        matchedId: r.match ? r.match.card.id : null,
        matchScore: r.match ? Number(r.match.score.toFixed(3)) : null,
        imageState: r.state.code,
        completeness: r.meter ? { filled: r.meter.filled, total: r.meter.total } : null,
        // NOTE: suffix is intentionally omitted from JSON (local-only).
      })),
      nonPaymentPasses: args.all
        ? others.map((o) => ({ name: o.name, kind: o.kind, style: o.style }))
        : undefined,
      summary: {
        totalPasses: records.length,
        paymentCards: payment.length,
        matched: rows.filter((r) => r.match).length,
        exportable: payment.filter((p) => p.exportable).length,
      },
      remote: { note: remoteNote, source: db ? db.source : null },
      export: args.export ? exportResults : undefined,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  }

  // Human table.
  const columns = [
    { key: 'wallet', title: '钱包卡片' },
    { key: 'issuer', title: '发卡行' },
    { key: 'dbcard', title: '匹配的 DB 卡片' },
    { key: 'meter', title: '数据完整度' },
    { key: 'art', title: '卡面' },
    { key: 'action', title: '建议动作' },
  ];
  const c = (code, s) => (color ? code + s + ANSI.reset : s);

  const tableRows = rows.map((r) => {
    const suffix = r.rec.suffix ? c(ANSI.gray, ` ····${r.rec.suffix}`) : '';
    let action;
    if (r.state.code === 'has-art') action = '数据已完善，可核对';
    else if (r.state.code === 'needs-art') action = '--export 后提交卡面 PR';
    else action = '开 Request-a-card / 提交完整 PR';
    if (!db) action = '（离线，见下）';
    return {
      wallet: truncate(r.rec.name, 28) + suffix,
      issuer: truncate(r.rec.issuer || '—', 22),
      dbcard: r.match ? truncate(r.match.card.id, 28) : '—',
      meter: r.meter ? r.meter.text : '—',
      art: r.state.label,
      action,
    };
  });

  if (args.all) {
    for (const o of others) {
      tableRows.push({
        wallet: c(ANSI.dim, truncate(o.name, 28)),
        issuer: c(ANSI.dim, truncate(o.issuer || '—', 22)),
        dbcard: c(ANSI.dim, `（${o.style || o.kind}）`),
        meter: c(ANSI.dim, '—'),
        art: c(ANSI.dim, '—（非支付卡）'),
        action: c(ANSI.dim, '不导出'),
      });
    }
  }

  process.stdout.write('\n');
  process.stdout.write(
    c(ANSI.bold, 'OpenCard DB · Apple Pay 卡面贡献助手 / card-art contribution helper') +
      '\n',
  );
  process.stdout.write(
    c(
      ANSI.gray,
      `扫描 ${records.length} 个 Wallet 通行证，其中支付卡 ${payment.length} 张。` +
        ` / Scanned ${records.length} passes; ${payment.length} payment card(s).`,
    ) + '\n\n',
  );

  if (tableRows.length === 0) {
    process.stdout.write(
      '未发现 Apple Pay 支付卡（此 Mac 只找到非支付通行证，如会员卡/登机牌）。\n' +
        'No Apple Pay payment cards found (only non-payment passes such as loyalty\n' +
        'cards or boarding passes are provisioned on this Mac).\n' +
        (args.all ? '' : '提示：加 --all 可在表格中列出这些非支付通行证。/ Tip: pass --all to list them.\n'),
    );
  } else {
    process.stdout.write(renderTable(columns, tableRows, { color }) + '\n');
  }

  // Per-state guidance.
  const hasNeedsArt = rows.some((r) => r.state.code === 'needs-art');
  const hasNotInDb = rows.some((r) => r.state.code === 'not-in-db');
  const hasExportable = payment.some((p) => p.exportable);

  process.stdout.write('\n' + c(ANSI.bold, '下一步 / Next steps:') + '\n');
  if (remoteNote === 'offline') {
    process.stdout.write(
      c(ANSI.yellow, '  • 离线：无法对照数据库，已降级为“仅导出”模式。/ Offline: DB compare skipped (export-only).') +
        '\n',
    );
  } else if (remoteNote === 'skipped') {
    process.stdout.write('  • 已用 --no-remote 跳过数据库对照。/ DB compare skipped via --no-remote.\n');
  }
  if (hasNeedsArt || (hasExportable && remoteNote)) {
    process.stdout.write(
      `  🟡 缺卡面：运行 ${c(ANSI.bold, 'npx opencard-export --export')}，` +
        `再把 images/<card-id>.png 通过 PR 提交（CI 转为无损 WebP）。\n` +
        `     Missing art: run ${c(ANSI.bold, 'npx opencard-export --export')}, then add images/<card-id>.png via PR (CI → lossless WebP).\n`,
    );
  }
  if (hasNotInDb) {
    process.stdout.write(
      `  🔴 未收录：打开求收录表单 / open the Request-a-card form:\n     ${c(ANSI.cyan, ISSUE_FORM_URL)}\n` +
        '     或提交完整卡片 PR。/ or contribute a full card PR.\n',
    );
  }
  if (!hasNeedsArt && !hasNotInDb && tableRows.length > 0) {
    process.stdout.write('  ✅ 你的支付卡都已收录且有卡面，感谢！/ All your payment cards are in the DB with art. Thank you!\n');
  }

  // Attribution footer (always, once).
  process.stdout.write('\n' + c(ANSI.gray, attributionNotice()) + '\n');

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write('opencard-export error: ' + (err && err.stack ? err.stack : String(err)) + '\n');
    process.exit(1);
  });
