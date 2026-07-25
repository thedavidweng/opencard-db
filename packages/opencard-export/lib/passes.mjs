// passes.mjs — enumerate and classify Apple Wallet pass bundles under
// ~/Library/Passes/Cards/, and locate the card-art asset for payment cards.
//
// ── Observed on-disk layout (macOS, this machine, 2026-07) ──────────────────
// ~/Library/Passes/Cards/<base64hash>.pkpass/   one directory per pass
//     pass.json        UTF-8 *or* UTF-16 (BOM feff) JSON
//     manifest.json, signature
//     icon@Nx.png, logo@Nx.png, strip@Nx.png, *.lproj/   (passbook assets)
// ~/Library/Passes/Cards/<base64hash>.cache/    rendered-face cache (encrypted
//     FrontFace / Preview / PlaceHolder — proprietary "data", NOT usable PNGs)
//
// Discriminator (verified empirically + Apple PassKit docs):
//   • Every *passbook* pass (loyalty / storeCard / eventTicket / boardingPass /
//     coupon / generic) carries exactly ONE passbook style dictionary as a
//     top-level key. All 35 local bundles had one of these keys.
//   • An Apple Pay *payment* pass (PKPaymentPass) does NOT carry a passbook
//     style key. Instead its bundle ships the digital card-art asset
//     `cardBackgroundCombined@2x.png` (community-standard extract target) and
//     typically a `paymentApplications` array / NFC payment fields.
// So: payment  ⇔  has cardBackgroundCombined art  OR  has paymentApplications
//                  OR (parsed pass.json with NONE of the passbook style keys).
// Only bundles that actually ship the art asset are exportable.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** The five passbook style dictionaries that mark a NON-payment pass. */
export const PASSBOOK_STYLE_KEYS = [
  'boardingPass',
  'coupon',
  'eventTicket',
  'storeCard',
  'generic',
];

/** Default Wallet Cards directory on macOS. */
export function defaultCardsDir() {
  return path.join(os.homedir(), 'Library', 'Passes', 'Cards');
}

/**
 * Decode a pass.json buffer that may be UTF-8 or UTF-16 (with BOM) and parse it.
 * Returns null if it cannot be parsed (e.g. genuinely binary / encrypted).
 * @param {Buffer} buf
 * @returns {object|null}
 */
export function parsePassJson(buf) {
  if (!buf || buf.length === 0) return null;
  const encodings =
    buf[0] === 0xff && buf[1] === 0xfe
      ? ['utf16le']
      : buf[0] === 0xfe && buf[1] === 0xff
        ? ['utf-16be', 'utf16le'] // Node lacks utf-16be; try swap fallback below
        : ['utf-8', 'utf16le'];
  for (const enc of encodings) {
    try {
      let text;
      if (enc === 'utf-16be') {
        // Byte-swap BE -> LE, then decode as LE.
        const swapped = Buffer.from(buf);
        for (let i = 0; i + 1 < swapped.length; i += 2) {
          const t = swapped[i];
          swapped[i] = swapped[i + 1];
          swapped[i + 1] = t;
        }
        text = swapped.toString('utf16le');
      } else {
        text = buf.toString(enc);
      }
      // Strip a leading BOM if any survived.
      text = text.replace(/^﻿/, '');
      return JSON.parse(text);
    } catch {
      // try next encoding
    }
  }
  return null;
}

/** Case-insensitive test for the payment card-art asset. */
function isCardArtAsset(name) {
  return /^cardbackgroundcombined.*\.png$/i.test(name);
}

/**
 * Pick the best card-art asset to export from a bundle's asset filenames.
 * Prefers cardBackgroundCombined@2x, then @3x, then base, then any
 * cardBackground*, and finally the largest strip asset as a last resort.
 * @param {string[]} assetNames
 * @returns {string|null}
 */
export function pickArtAsset(assetNames) {
  const names = assetNames || [];
  const prefs = [
    (n) => /^cardbackgroundcombined@2x\.png$/i.test(n),
    (n) => /^cardbackgroundcombined@3x\.png$/i.test(n),
    (n) => /^cardbackgroundcombined\.png$/i.test(n),
    (n) => /^cardbackgroundcombined.*\.png$/i.test(n),
    (n) => /^cardbackground.*@3x\.png$/i.test(n),
    (n) => /^cardbackground.*@2x\.png$/i.test(n),
    (n) => /^cardbackground.*\.png$/i.test(n),
    (n) => /^strip@3x\.png$/i.test(n),
    (n) => /^strip@2x\.png$/i.test(n),
  ];
  for (const pref of prefs) {
    const hit = names.find(pref);
    if (hit) return hit;
  }
  return null;
}

/**
 * Classify a single bundle from its parsed pass.json and asset filenames.
 * @param {{passJson:object|null, assetNames:string[]}} input
 * @returns {{kind:'payment'|'passbook'|'unknown', style:string|null,
 *            exportable:boolean, artAsset:string|null, reason:string}}
 */
export function classifyPass({ passJson, assetNames }) {
  const names = assetNames || [];
  const artAsset = pickArtAsset(names);
  const hasCardArt = names.some(isCardArtAsset);
  const hasPaymentApps = !!(passJson && passJson.paymentApplications);
  const styleKey = passJson
    ? PASSBOOK_STYLE_KEYS.find((k) => Object.prototype.hasOwnProperty.call(passJson, k)) || null
    : null;

  // Strongest signal: the payment card-art asset is present -> payment, export.
  if (hasCardArt) {
    return {
      kind: 'payment',
      style: null,
      exportable: true,
      artAsset,
      reason: 'has cardBackgroundCombined art asset',
    };
  }
  // Payment applications present but no extractable art (secure-element only).
  if (hasPaymentApps) {
    return {
      kind: 'payment',
      style: null,
      exportable: false,
      artAsset,
      reason: 'has paymentApplications; no extractable art asset',
    };
  }
  // Passbook pass: carries a style dictionary.
  if (styleKey) {
    return {
      kind: 'passbook',
      style: styleKey,
      exportable: false,
      artAsset: null,
      reason: `passbook style: ${styleKey}`,
    };
  }
  // Parsed JSON with no style key and no art -> payment shell (secure element).
  if (passJson) {
    return {
      kind: 'payment',
      style: null,
      exportable: false,
      artAsset,
      reason: 'no passbook style key; no extractable art (secure element)',
    };
  }
  // Unparseable and no art -> cannot classify.
  return {
    kind: 'unknown',
    style: null,
    exportable: false,
    artAsset: null,
    reason: 'pass.json unreadable and no art asset',
  };
}

/**
 * Display-friendly basics from a pass.json. Prefers the product description,
 * then organizationName, then logoText. Never returns a PAN/token.
 * Suffix (if the pass exposes one) is returned separately and is LOCAL-ONLY —
 * callers must never write it to disk.
 * @param {object|null} passJson
 * @returns {{name:string, issuer:string, suffix:string|null}}
 */
export function extractInfo(passJson) {
  if (!passJson) return { name: 'Unknown pass', issuer: '', suffix: null };
  const name =
    (passJson.description && String(passJson.description).trim()) ||
    (passJson.organizationName && String(passJson.organizationName).trim()) ||
    (passJson.logoText && String(passJson.logoText).trim()) ||
    'Unknown pass';
  const issuer =
    (passJson.organizationName && String(passJson.organizationName).trim()) || '';
  // A few payment-pass layouts expose a display suffix (last 4). Show it on
  // screen only; it is never written to any exported file or JSON report.
  const suffix =
    passJson.primaryAccountNumberSuffix ||
    passJson.accountSuffix ||
    (passJson.paymentApplications &&
      passJson.paymentApplications[0] &&
      passJson.paymentApplications[0].primaryAccountNumberSuffix) ||
    null;
  return { name, issuer, suffix: suffix ? String(suffix) : null };
}

/**
 * Read a permission-preflight error for the Cards directory. Throws a typed
 * Error with `.code` set when access is denied so the CLI can show the FDA
 * guide. Resolves silently when the directory is readable.
 * @param {string} dir
 */
export async function preflight(dir) {
  await fs.readdir(dir); // throws EACCES/EPERM/ENOENT — caller inspects .code
}

/**
 * Scan a Cards directory and return a classified record per *.pkpass bundle.
 * Does NOT read pass *values* into the returned record beyond safe display
 * basics. Never copies PANs/tokens.
 * @param {string} [dir]
 * @returns {Promise<Array<object>>}
 */
export async function scanCards(dir = defaultCardsDir()) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const bundles = entries.filter(
    (e) => e.isDirectory() && e.name.endsWith('.pkpass'),
  );
  const records = [];
  for (const b of bundles) {
    const bundleDir = path.join(dir, b.name);
    let assetNames = [];
    try {
      assetNames = await fs.readdir(bundleDir);
    } catch {
      assetNames = [];
    }
    let passJson = null;
    try {
      const buf = await fs.readFile(path.join(bundleDir, 'pass.json'));
      passJson = parsePassJson(buf);
    } catch {
      passJson = null;
    }
    const cls = classifyPass({ passJson, assetNames });
    const info = extractInfo(passJson);
    records.push({
      bundle: b.name,
      bundleDir,
      kind: cls.kind,
      style: cls.style,
      exportable: cls.exportable,
      artAsset: cls.artAsset,
      reason: cls.reason,
      name: info.name,
      issuer: info.issuer,
      suffix: info.suffix, // local-only; never serialized to disk
    });
  }
  return records;
}
