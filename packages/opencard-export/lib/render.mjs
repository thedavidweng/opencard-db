// render.mjs — table rendering for a one-shot CLI, modeled on gh's output
// discipline: aligned columns, one colored status column, dim metadata, no
// banners. No dependencies. Handles CJK double-width glyphs so card names stay
// aligned, and honors NO_COLOR / a color=false flag.

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
 * fixed display order used by the DATA meter. `label` is the short mark label.
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
 * Populated-field completeness for a matched DB card. Counts how many of the
 * six core fields carry real data.
 * @param {object|null} card
 * @returns {{filled:number, total:number, text:string,
 *            fields:Array<{key:string,label:string,ok:boolean}>}}
 */
export function completenessMeter(card) {
  const fields = completenessFields(card);
  const filled = fields.filter((f) => f.ok).length;
  const total = fields.length;
  return { filled, total, text: `${filled}/${total}`, fields };
}

/**
 * Presentation for the STATUS column: the three states a wallet card can be
 * in relative to the database, in words an outsider understands. Only this
 * column carries color.
 *   not-in-database  the database has no entry for this card; a new card
 *                    entry can be contributed
 *   art-wanted       the card is in the database, but this Apple Pay export
 *                    is not: a new or better card face can be contributed
 *   up-to-date       the database already has this card and this exact art;
 *                    contributing again would be a duplicate
 */
export const STATUS_LABELS = {
  'not-in-database': { word: 'not in database', color: ANSI.red },
  'art-wanted': { word: 'art wanted', color: ANSI.yellow },
  'up-to-date': { word: 'up to date', color: ANSI.green },
};

const HEADERS = ['NAME', 'ISSUER', 'MATCH', 'DATA', 'STATUS'];
const CAPS = [32, 22, 40, 4, 15];
const GUTTER = '  ';

/**
 * Render wallet cards as one aligned table (gh-style: dim uppercase header,
 * two-space gutters, colored STATUS column, unmatched rows dimmed).
 *
 * @param {Array<{name:string, issuer?:string, matchedId?:string|null,
 *          filled?:number|null, total?:number|null,
 *          status?:'not-in-database'|'art-wanted'|'up-to-date'|null}>} entries
 * @param {{color?:boolean}} [opts]
 * @returns {string} newline-joined table
 */
export function renderCardTable(entries, opts = {}) {
  const color = opts.color ?? colorEnabled();
  const c = (code, s) => (color ? code + s + ANSI.reset : s);

  const cells = entries.map((e) => {
    const matched = !!e.matchedId;
    const status = e.status ? STATUS_LABELS[e.status] : null;
    return {
      matched,
      status,
      cols: [
        truncate(e.name, CAPS[0]),
        truncate(e.issuer || '', CAPS[1]),
        matched ? truncate(e.matchedId, CAPS[2]) : '-',
        matched && e.filled != null ? `${e.filled}/${e.total}` : '-',
        status ? status.word : '-',
      ],
    };
  });

  const widths = HEADERS.map((h, i) =>
    Math.max(displayWidth(h), ...cells.map((r) => displayWidth(r.cols[i]))),
  );
  const pad = (s, i) =>
    i === widths.length - 1 ? s : s + ' '.repeat(widths[i] - displayWidth(s));

  const lines = [c(ANSI.dim, HEADERS.map(pad).join(GUTTER))];
  for (const row of cells) {
    const statusCell = row.status ? c(row.status.color, row.cols[4]) : row.cols[4];
    if (!row.matched) {
      // Dash DB columns, dimmed; the status word keeps its color so the
      // "you could add this card" state stays visible.
      const plain = c(ANSI.dim, row.cols.slice(0, 4).map(pad).join(GUTTER));
      lines.push(plain + GUTTER + statusCell);
      continue;
    }
    const plain = row.cols.slice(0, 4).map(pad).join(GUTTER);
    lines.push(plain + GUTTER + statusCell);
  }
  return lines.join('\n');
}

export { ANSI };
