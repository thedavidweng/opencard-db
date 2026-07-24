# Contributing Cards

Data changes are **Pull Request only**. There is no public write API.

## Prefer one Card per PR

Easier review, clearer Sources, fewer merge conflicts.

## Requirements

1. File path: `data/{country}/{slug}.json`
2. `id` must be `{country}-{slug}` (stable forever once merged)
3. Valid against root `schema.json` (`npm run validate`)
4. At least one official **Source** URL (product page and/or terms)
5. `last_verified` set to the date you checked official pages
6. Images are optional. Prefer official issuer URLs when stable; for local mirrors, **Apple Pay** `cardBackgroundCombined@2x.png` → lossless WebP is the graduation-level bar (see `images/README.md`, `docs/research/apple-pay-card-art.md`). Do not scrape Apple remotely. CI: `npm run optimize:images`

## Domain rules (see CONTEXT.md)

- **Issuer** ≠ **Network** (e.g. Scotiabank + Amex)
- Product names (Cobalt, Gold, Platinum) go in `name`, not `network_tier`
- `network_tier` is the network package (`infinite`, `signature`, `world_elite`, `diamond`, `none`, …)
- All perks live in `benefits[]` with `source` and `category`
- Signup Bonus ≠ Rewards ≠ Benefits

## Workflow

```bash
# edit data/us/my-card.json
npm run validate
npm test
# open PR with Sources listed in the template
```

## Licenses

- Code: MIT  
- Data you contribute: CC BY 4.0  
- Card artwork: remains bank copyright  
