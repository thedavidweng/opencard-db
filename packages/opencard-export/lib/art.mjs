// art.mjs — card-art graduation logic: hash a local Apple Pay export, parse its
// PNG dimensions, and classify it against a DB card's known SHA lineage into one
// of four art tiers. Pure, Node-built-ins only (node:crypto), so it is trivially
// testable and never touches the network.
//
// The three-tier graduation model (see docs/schema-notes.md "Card art lineage &
// graduation"):
//   graduated    — the DB already has THIS exact Apple Pay art (sha in lineage).
//   new-design   — the DB's art is Apple Pay but a different sha (bank refreshed
//                  the design, or this is an @3x variant).
//   upgradeable  — the DB's art is issuer-site (or has no provenance) — a lossless
//                  Apple Pay export beats it.
//   missing      — the DB card has no art at all.

import { createHash } from 'node:crypto';

/**
 * Lowercase hex sha256 of a buffer.
 * @param {Buffer|Uint8Array|string} buf
 * @returns {string}
 */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** The 8-byte PNG signature. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Parse a PNG's pixel dimensions straight from its IHDR header: 8-byte magic,
 * then the IHDR chunk whose width/height are big-endian u32s at byte offsets 16
 * and 20. Returns null when the buffer is not a PNG or is too short to hold an
 * IHDR (Node built-ins only — no image library).
 * @param {Buffer} buf
 * @returns {{width:number, height:number}|null}
 */
export function parsePngDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  if (!Buffer.prototype.equals.call(buf.subarray(0, 8), PNG_MAGIC)) return null;
  // Chunk type at bytes 12..15 must be "IHDR".
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

/**
 * Every sha256 the DB associates with a card's art design: the provenance
 * anchor (source_sha256), its alternate exports (alternate_sha256[]), and each
 * superseded history[] source_sha256. Lowercased for stable comparison.
 * @param {object|null} card
 * @returns {Set<string>}
 */
export function knownShaSet(card) {
  const set = new Set();
  const img = card && card.image;
  if (!img) return set;
  const p = img.provenance;
  if (p) {
    if (p.source_sha256) set.add(String(p.source_sha256).toLowerCase());
    for (const s of p.alternate_sha256 || []) {
      if (s) set.add(String(s).toLowerCase());
    }
  }
  for (const h of img.history || []) {
    if (h && h.source_sha256) set.add(String(h.source_sha256).toLowerCase());
  }
  return set;
}

/**
 * Classify a matched DB card's art against the local Apple Pay export's sha.
 * @param {object|null} card       the matched DB card
 * @param {string|null} localSha   sha256 of the local Apple Pay PNG (or null)
 * @returns {'graduated'|'new-design'|'upgradeable'|'missing'}
 */
export function artStatus(card, localSha) {
  const img = card && card.image;
  const hasArt = !!(img && (img.url || img.local_path));
  if (!hasArt) return 'missing';
  if (localSha && knownShaSet(card).has(String(localSha).toLowerCase())) {
    return 'graduated';
  }
  const source = img && img.provenance && img.provenance.source;
  if (source === 'apple-pay') return 'new-design';
  return 'upgradeable';
}

/**
 * Build the provenance block a contributor pastes into a card's `image`. Field
 * order matches the schema example: source, source_sha256, [width, height],
 * exported_at. width/height are omitted when unknown (couldn't parse IHDR).
 * @param {{sha256:string, width?:number|null, height?:number|null, exportedAt:string}} p
 * @returns {object}
 */
export function buildProvenanceBlock({ sha256: sha, width, height, exportedAt }) {
  const block = { source: 'apple-pay', source_sha256: sha };
  if (width != null) block.width = width;
  if (height != null) block.height = height;
  block.exported_at = exportedAt;
  return block;
}

/**
 * Render a provenance block as a paste-ready `"provenance": { … }` snippet
 * (2-space indented, matching the card JSON files' formatting).
 * @param {object} block
 * @returns {string}
 */
export function provenanceSnippet(block) {
  return '"provenance": ' + JSON.stringify(block, null, 2);
}

/** Today's date as YYYY-MM-DD (UTC), for provenance.exported_at. */
export function today(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
