// table.mjs — hand-rolled ANSI table + data-completeness meter. No dependencies.
// Handles CJK double-width glyphs so bilingual columns stay aligned, and honors
// NO_COLOR / a color=false flag.

const ANSI = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  green: '[32m',
  yellow: '[33m',
  red: '[31m',
  cyan: '[36m',
  gray: '[90m',
};

/** Whether colored output should be emitted. */
export function colorEnabled(env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  return true;
}

const ANSI_RE = /\[[0-9;]*m/g;

/** Strip ANSI escape codes. */
export function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '');
}

/**
 * Terminal display width of a string, counting East-Asian wide / fullwidth
 * codepoints and emoji as 2 columns and ignoring ANSI escapes.
 */
export function displayWidth(s) {
  const str = stripAnsi(String(s));
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp === 0) continue;
    if (isWide(cp)) w += 2;
    else w += 1;
  }
  return w;
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana..CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji / symbols
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+
  );
}

/**
 * Collapse newlines/tabs to single spaces (pass descriptions can contain literal
 * line breaks that would otherwise split a table cell across rows).
 */
export function sanitizeCell(s) {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * Truncate to a maximum display width (CJK-aware), appending '…'. Operates on
 * plain text only — apply color AFTER truncating.
 */
export function truncate(s, max) {
  const clean = sanitizeCell(s);
  if (displayWidth(clean) <= max) return clean;
  let w = 0;
  let out = '';
  for (const ch of clean) {
    const cw = displayWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

/** Right-pad `s` with spaces to `width` display columns. */
function padEnd(s, width) {
  const pad = width - displayWidth(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}

/**
 * Populated-field completeness meter for a matched DB card. Counts how many of
 * six core fields carry real data: annual_fee, apr, fx_fee, rewards,
 * signup_bonus, image.
 * @param {object|null} card
 * @returns {{filled:number, total:number, bar:string, text:string}}
 */
export function completenessMeter(card) {
  const total = 6;
  let filled = 0;
  if (card) {
    if (card.annual_fee && card.annual_fee.amount != null) filled++;
    if (
      card.apr &&
      ((card.apr.purchase &&
        (card.apr.purchase.min != null || card.apr.purchase.max != null)) ||
        (card.apr.cash_advance &&
          (card.apr.cash_advance.min != null || card.apr.cash_advance.max != null)))
    )
      filled++;
    if (card.fx_fee && card.fx_fee.percent != null) filled++;
    if (
      card.rewards &&
      card.rewards.base_rate &&
      card.rewards.base_rate.points_per_dollar != null
    )
      filled++;
    if (card.signup_bonus && card.signup_bonus.amount != null) filled++;
    if (card.image && (card.image.url || card.image.local_path)) filled++;
  }
  const bar = '▮'.repeat(filled) + '▯'.repeat(total - filled);
  return { filled, total, bar, text: `${bar} ${filled}/${total}` };
}

/**
 * Render a table. `columns` is [{key,title}], `rows` is array of objects whose
 * values are already-formatted strings (may contain ANSI when color is on).
 * @param {Array<{key:string,title:string}>} columns
 * @param {Array<Record<string,string>>} rows
 * @param {{color?:boolean}} [opts]
 * @returns {string}
 */
export function renderTable(columns, rows, opts = {}) {
  const color = opts.color ?? colorEnabled();
  const c = (code, s) => (color ? code + s + ANSI.reset : s);

  // Defensive: never let an embedded newline split a cell across rows.
  const cell = (r, key) => {
    const v = r[key] ?? '';
    return v.includes('\n') || v.includes('\r') ? sanitizeCell(v) : v;
  };

  const widths = columns.map((col) =>
    Math.max(
      displayWidth(col.title),
      ...rows.map((r) => displayWidth(cell(r, col.key))),
    ),
  );

  const line = (left, mid, right, fill) =>
    left + widths.map((w) => fill.repeat(w + 2)).join(mid) + right;

  const top = line('┌', '┬', '┐', '─');
  const sep = line('├', '┼', '┤', '─');
  const bot = line('└', '┴', '┘', '─');

  const header =
    '│' +
    columns
      .map((col, i) => ' ' + c(ANSI.bold, padEnd(col.title, widths[i])) + ' ')
      .join('│') +
    '│';

  const body = rows.map(
    (r) =>
      '│' +
      columns
        .map((col, i) => ' ' + padEnd(cell(r, col.key), widths[i]) + ' ')
        .join('│') +
      '│',
  );

  return [top, header, sep, ...body, bot].join('\n');
}

export { ANSI };
