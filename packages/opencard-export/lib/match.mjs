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

/**
 * Score a wallet card against a DB card in [0, 1]. Name-token overlap dominates;
 * a shared issuer token adds a bounded bonus.
 * @param {{name?:string, issuer?:string}} wallet
 * @param {{name?:string, issuer?:string}} db
 * @returns {number}
 */
export function scoreMatch(wallet, db) {
  const wName = nameTokens(wallet.name);
  const dName = nameTokens(db.name);
  const nameScore = jaccard(wName, dName);

  const wIss = new Set(normalizeIssuer(wallet.issuer));
  const dIss = new Set(normalizeIssuer(db.issuer));
  let issuerShared = false;
  for (const t of wIss) if (dIss.has(t)) { issuerShared = true; break; }

  // Name overlap is the primary signal (0..1). Issuer agreement nudges it up;
  // an issuer *conflict* (both known but disjoint) nudges it down slightly.
  let score = nameScore;
  if (issuerShared) score = Math.min(1, score + 0.15);
  else if (wIss.size && dIss.size) score = Math.max(0, score - 0.1);
  return score;
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
