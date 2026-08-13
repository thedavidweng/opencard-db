// Build the GitHub PR title + beginner-form body for an Apple Pay art
// contribution, and (optionally) run git/gh to open it.

import { attributionLine } from './attribution.mjs';

/**
 * @param {Array<{id:string, name?:string, country?:string, issuer?:string,
 *   network?:string, network_tier?:string, official_url?:string,
 *   annual_fee?:{amount?:number|null, currency?:string},
 *   signup_bonus?:{amount?:number|null, unit?:string}|null,
 *   last_verified?:string, sources?:string[]}>} cards
 * @param {string} today YYYY-MM-DD
 */
export function buildArtPr(cards, today) {
  const list = (cards || []).filter((c) => c && c.id);
  if (list.length === 0) return null;
  if (list.length === 1) {
    return {
      title: `card(update): ${list[0].id}`,
      body: singleCardBody(list[0], today),
      kind: 'card-update',
    };
  }
  return {
    title: 'fix(data): add Apple Pay card art',
    body: multiCardBody(list, today),
    kind: 'bulk',
  };
}

function singleCardBody(card, today) {
  const country = card.country || String(card.id).slice(0, 2);
  const slug = String(card.id).startsWith(country + '-')
    ? String(card.id).slice(country.length + 1)
    : String(card.id);
  const file = `data/${country}/${slug}.json`;
  const fee = card.annual_fee || {};
  const bonus = card.signup_bonus;
  const bonusText =
    bonus && bonus.amount != null
      ? `${bonus.amount} ${bonus.unit || ''}`.trim()
      : 'unknown';
  const product = card.official_url || (card.sources && card.sources[0]) || 'unknown';
  const terms =
    (card.sources || []).find((s) => s && s !== product) || product;
  return `## What kind of change is this?

- [x] **Update existing card**

## Card form

### 1. Identity

- **Card ID:** \`${card.id}\`
- **Country:** \`${country}\`
- **File path:** \`${file}\`
- **Display name:** ${card.name || card.id}

### 2. Official sources (required)

- **Product page:** ${product}
- **Terms / benefits page:** ${terms}
- **Last verified (YYYY-MM-DD):** ${today}

### 3. Card image (pick the best you can)

- [x] **B. Apple Pay extract (preferred local mirror — “graduation-level”)**
  - **Attribution:** ${attributionLine(card.issuer)}

### 4. Quick facts (helps reviewers)

- **Issuer:** ${card.issuer || 'unknown'}
- **Network:** \`${card.network || 'unknown'}\`
- **Network tier:** \`${card.network_tier || 'none'}\`
- **Annual fee:** \`${fee.amount ?? 'unknown'}\` **Currency:** \`${fee.currency || 'USD'}\`
- **Signup bonus (short):** ${bonusText}

### 5. Checklist

- [x] I copied \`templates/card.template.json\` → \`data/{country}/{slug}.json\` (or edited an existing file)
- [x] \`id\` in the JSON equals \`{country}-{slug}\` and matches the file path
- [x] \`sources\` lists the official URLs above
- [x] \`last_verified\` is the date I checked
- [x] Issuer and Network are separate fields (product names are NOT in \`network_tier\`)
- [x] I understand card artwork stays bank copyright

## Notes for reviewers

Apple Pay digital card art exported with \`npx opencard-export --export --repo .\`. CI converts the PNG to lossless WebP and fills \`converted_sha256\`.
`;
}

function multiCardBody(cards, today) {
  const rows = cards
    .map((c) => `- \`${c.id}\` — ${c.name || c.id}`)
    .join('\n');
  return `## What kind of change is this?

- [x] **Not a card** (docs / CI / code / bulk data maintenance)

## Summary

Apple Pay digital card art for ${cards.length} cards, exported ${today} with \`npx opencard-export --export --repo .\`.

${rows}

CI converts each PNG to lossless WebP and fills \`image.provenance.converted_sha256\`. Card artwork remains the copyright of the issuing bank.
`;
}

/**
 * Human-readable next-step commands for a contribution that has already
 * written PNGs + provenance into a checkout.
 */
export function nextStepCommands({ branch, files, title, bodyFile }) {
  const add = (files || []).join(' ');
  return [
    `git checkout -b ${branch}`,
    `git add ${add}`,
    `git commit -m "${title}"`,
    'git push -u origin HEAD',
    `gh pr create --title "${title}" --body-file ${bodyFile}`,
  ];
}
