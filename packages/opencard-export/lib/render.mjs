// render.mjs — dot-list rendering primitives for a dark-terminal, one-shot CLI
// (tokscale-style). No dependencies. Handles CJK double-width glyphs so card
// names stay aligned, and honors NO_COLOR / a color=false flag.

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/** Whether colored output should be emitted. */
export function colorEnabled(env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  return true;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

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
 * line breaks that would otherwise split a line).
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

/**
 * The six core fields whose presence defines a DB card's completeness, in the
 * fixed display order used by the dot-list. `label` is the short mark label.
 * @param {object|null} card
 * @returns {Array<{key:string,label:string,ok:boolean}>}
 */
export function completenessFields(card) {
  const c = card || null;
  return [
    {
      key: 'annual_fee',
      label: 'Fee',
      ok: !!(c && c.annual_fee && c.annual_fee.amount != null),
    },
    {
      key: 'apr',
      label: 'APR',
      ok: !!(
        c &&
        c.apr &&
        ((c.apr.purchase &&
          (c.apr.purchase.min != null || c.apr.purchase.max != null)) ||
          (c.apr.cash_advance &&
            (c.apr.cash_advance.min != null || c.apr.cash_advance.max != null)))
      ),
    },
    {
      key: 'fx_fee',
      label: 'FX',
      ok: !!(c && c.fx_fee && c.fx_fee.percent != null),
    },
    {
      key: 'rewards',
      label: 'Rewards',
      ok: !!(
        c &&
        c.rewards &&
        c.rewards.base_rate &&
        c.rewards.base_rate.points_per_dollar != null
      ),
    },
    {
      key: 'signup_bonus',
      label: 'Bonus',
      ok: !!(c && c.signup_bonus && c.signup_bonus.amount != null),
    },
    {
      key: 'image',
      label: 'Art',
      ok: !!(c && c.image && (c.image.url || c.image.local_path)),
    },
  ];
}

/**
 * Populated-field completeness meter for a matched DB card. Counts how many of
 * the six core fields carry real data.
 * @param {object|null} card
 * @returns {{filled:number, total:number, bar:string, text:string,
 *            fields:Array<{key:string,label:string,ok:boolean}>}}
 */
export function completenessMeter(card) {
  const fields = completenessFields(card);
  const filled = fields.filter((f) => f.ok).length;
  const total = fields.length;
  const bar = '▮'.repeat(filled) + '▯'.repeat(total - filled);
  return { filled, total, bar, text: `${bar} ${filled}/${total}`, fields };
}

/**
 * Status presentation for a card's art/DB state. `code` is one of the three
 * imageState codes; each maps to a colored dot and a footer-style word.
 */
export const STATUS = {
  'has-art': { color: ANSI.green, word: 'complete' },
  'needs-art': { color: ANSI.yellow, word: 'missing art' },
  'not-in-db': { color: ANSI.red, word: 'not in DB' },
};

/**
 * Render one payment card as two dot-list lines.
 *   line 1: <dot> <bold name> <dim (issuer)>            <status word>  (right-aligned)
 *   line 2: dimmed, indented → matched id · per-field ✓/✗  (or "not in OpenCard DB yet")
 * Returns the two lines joined by "\n". Apply no external color — coloring is
 * driven by `opts.color`.
 *
 * @param {{name:string, issuer?:string, stateCode:'has-art'|'needs-art'|'not-in-db',
 *          matchedId?:string|null, fields?:Array<{label:string,ok:boolean}>}} entry
 * @param {{color?:boolean, width?:number}} [opts]
 * @returns {string}
 */
export function renderCardEntry(entry, opts = {}) {
  const color = opts.color ?? colorEnabled();
  const width = opts.width || 72;
  const c = (code, s) => (color ? code + s + ANSI.reset : s);
  const st = STATUS[entry.stateCode] || STATUS['not-in-db'];

  const dot = c(st.color, '●');
  const name = c(ANSI.bold, truncate(entry.name, 40));
  const issuer =
    entry.issuer && String(entry.issuer).trim()
      ? ' ' + c(ANSI.dim, `(${truncate(entry.issuer, 24)})`)
      : '';
  const left = `${dot} ${name}${issuer}`;
  const word = c(st.color, st.word);

  const gap = Math.max(1, width - displayWidth(left) - displayWidth(st.word));
  const line1 = left + ' '.repeat(gap) + word;

  let line2;
  if (entry.matchedId) {
    const marks = (entry.fields || [])
      .map((f) => `${f.label} ${f.ok ? '✓' : '✗'}`)
      .join(' ');
    line2 = c(ANSI.dim, `  → ${entry.matchedId} · ${marks}`);
  } else {
    line2 = c(ANSI.dim, '  → not in OpenCard DB yet');
  }
  return line1 + '\n' + line2;
}

export { ANSI };
