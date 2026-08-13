// match.mjs — normalize wallet card names/issuers and fuzzy-match them to the
// live OpenCard DB records. Pure logic, no I/O, so it is trivially testable.

// Issuer aliases fold common brand variants onto one canonical token so that a
// wallet's "American Express" matches a DB card whose issuer is "Amex", etc.
// Keys are already-normalized (lowercase, no punctuation) phrases.
const ISSUER_ALIASES = new Map([
  ['american express', 'amex'],
  ['amex', 'amex'],
  ['bank of america', 'boa'],
  ['boa', 'boa'],
  ['bofa', 'boa'],
  ['jpmorgan chase', 'chase'],
  ['jp morgan chase', 'chase'],
  ['jpmorgan', 'chase'],
  ['chase', 'chase'],
  ['capital one', 'capitalone'],
  ['capitalone', 'capitalone'],
  ['wells fargo', 'wellsfargo'],
  ['citibank', 'citi'],
  ['citi', 'citi'],
  ['us bank', 'usbank'],
  ['u s bank', 'usbank'],
  ['td bank', 'td'],
  ['toronto dominion', 'td'],
  ['royal bank of canada', 'rbc'],
  ['rbc', 'rbc'],
  ['scotiabank', 'scotiabank'],
  ['bank of montreal', 'bmo'],
  ['bmo', 'bmo'],
  ['china merchants bank', 'cmb'],
  ['cmb', 'cmb'],
  ['industrial and commercial bank of china', 'icbc'],
  ['icbc', 'icbc'],
]);

// Noise words dropped from card display names before token comparison — they
// carry no discriminating signal ("Chase Sapphire Preferred Card" ≈ "Sapphire
// Preferred").
const NAME_STOPWORDS = new Set([
  'card', 'cards', 'credit', 'debit', 'charge', 'the', 'a', 'an',
  'visa', 'mastercard', 'amex', 'discover', 'unionpay', 'jcb',
  'rewards', 'reward',
]);

/**
 * Lowercase, drop trademark/diacritic marks, and strip punctuation to spaces.
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function normalizeText(s) {
  if (!s) return '';
  return String(s)
    .replace(/[™®©]/g, ' ') // strip ™ ® © before NFKD (™ would decompose to "TM")
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ') // keep alnum + CJK
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical issuer token(s). Applies the alias table, then falls back to the
 * normalized words if no alias matches.
 * @param {string|null|undefined} issuer
 * @returns {string[]}
 */
export function normalizeIssuer(issuer) {
  const norm = normalizeText(issuer);
  if (!norm) return [];
  if (ISSUER_ALIASES.has(norm)) return [ISSUER_ALIASES.get(norm)];
  // Try substring alias hits (e.g. "chase bank" contains "chase").
  for (const [phrase, canon] of ISSUER_ALIASES) {
    if (norm === phrase || norm.startsWith(phrase + ' ') || norm.includes(' ' + phrase)) {
      return [canon];
    }
  }
  return norm.split(' ').filter(Boolean);
}

/**
 * Meaningful name tokens (stopwords removed).
 * @param {string|null|undefined} name
 * @returns {string[]}
 */
export function nameTokens(name) {
  return normalizeText(name)
    .split(' ')
    .filter((t) => t && !NAME_STOPWORDS.has(t));
}

function jaccard(aArr, bArr) {
  const a = new Set(aArr);
  const b = new Set(bArr);
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Tokens that distinguish sibling products (Gold vs Business Gold, Preferred
// vs Reserve). A DB-only discriminator is a strong negative — better to miss
// than to write art onto the wrong Card Id.
export const DISCRIMINATOR_TOKENS = new Set([
  'business', 'corp', 'corporate', 'commercial',
  'reserve', 'preferred', 'premier', 'plus', 'infinite',
  'select', 'secured', 'student', 'rise', 'flex',
  'signature', 'platinum', 'gold', 'green', 'blue',
  'explorer', 'explore', 'quest', 'gateway', 'club',
  'aspire', 'surpass', 'brilliant', 'bevy',
  'bold', 'boundless', 'bountiful',
]);

function dbNameVariants(db) {
  const out = [];
  if (db && db.name) out.push(db.name);
  if (db && db.localized_names && typeof db.localized_names === 'object') {
    for (const v of Object.values(db.localized_names)) {
      if (v) out.push(String(v));
    }
  }
  if (db && db.id) {
    out.push(String(db.id).replace(/^[a-z]{2}-/, '').replace(/-/g, ' '));
  }
  return out;
}

function scoreAgainstName(wallet, dbName, dbIssuer) {
  const wName = nameTokens(wallet.name);
  const dName = nameTokens(dbName);
  if (normalizeText(wallet.name) && normalizeText(wallet.name) === normalizeText(dbName)) {
    return 1;
  }
  const nameScore = jaccard(wName, dName);

  const wIss = new Set(normalizeIssuer(wallet.issuer));
  const dIss = new Set(normalizeIssuer(dbIssuer));
  let issuerShared = false;
  for (const t of wIss) if (dIss.has(t)) { issuerShared = true; break; }

  let score = nameScore;
  if (issuerShared) score = Math.min(1, score + 0.15);
  else if (wIss.size && dIss.size) score = Math.max(0, score - 0.1);

  const wSet = new Set(wName);
  let penalty = 0;
  for (const t of dName) {
    if (DISCRIMINATOR_TOKENS.has(t) && !wSet.has(t)) penalty += 0.2;
  }
  return Math.max(0, score - penalty);
}

/**
 * Score a wallet card against a DB card in [0, 1]. Name-token overlap dominates;
 * a shared issuer token adds a bounded bonus. Extra DB-only product-line
 * tokens (business / reserve / …) are penalised so siblings don't collide.
 * @param {{name?:string, issuer?:string}} wallet
 * @param {{name?:string, issuer?:string, id?:string, localized_names?:object}} db
 * @returns {number}
 */
export function scoreMatch(wallet, db) {
  let best = 0;
  for (const name of dbNameVariants(db)) {
    const s = scoreAgainstName(wallet, name, db && db.issuer);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Best DB match for a wallet card, or null if nothing clears the threshold.
 * @param {{name?:string, issuer?:string}} wallet
 * @param {Array<object>} dbCards
 * @param {{threshold?:number}} [opts]
 * @returns {{card:object, score:number}|null}
 */
export function matchCard(wallet, dbCards, opts = {}) {
  const threshold = opts.threshold ?? 0.34;
  let best = null;
  for (const card of dbCards || []) {
    const score = scoreMatch(wallet, card);
    if (!best || score > best.score) best = { card, score };
  }
  if (best && best.score >= threshold) return best;
  return null;
}
