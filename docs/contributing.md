# Contributing Cards

Data changes are **Pull Request only**. There is no public write API.

## Prefer one Card per PR

Easier review, clearer Sources, fewer merge conflicts.

## Beginner path (recommended)

1. **Fork** the repo and create a branch.
2. Copy the starter file:
   ```bash
   cp templates/card.template.json data/us/my-card-slug.json
   ```
   Use `data/ca/` or `data/cn/` for those markets. Rename the file; never commit `example-card`.
3. Edit the JSON (id must be `{country}-{slug}`, matching the file path).
4. Open a Pull Request — GitHub pre-fills a **form**. Replace the example values.
5. Set the **PR title** to exactly:
   ```text
   Add card: us-my-card-slug
   ```
   (or `Update card: …` when editing an existing card)
6. For images: official bank URL when stable, or — **best local mirror** — Apple Pay `cardBackgroundCombined@2x.png` from your Mac Wallet (`images/us-my-card-slug.png` → CI **lossless WebP**, native size). See `images/README.md` and `docs/research/apple-pay-card-art.md`. Do not scrape Apple remotely.
7. Wait for checks: Validate, PR Triage, and (if you uploaded images) Optimize Images.

CI will **comment and label** the PR if the title or form fields are incomplete (`needs-info`, `US` / `CA` / `CN`, etc.).

## Requirements

1. File path: `data/{country}/{slug}.json`
2. `id` must be `{country}-{slug}` (stable forever once merged)
3. Valid against root `schema.json` (`npm run validate`)
4. At least one official **Source** URL (product page and/or terms)
5. `last_verified` set to the date you checked official pages
6. Images are optional. Prefer official issuer URLs when stable; for local mirrors, Apple Pay @2x → lossless WebP is the graduation-level bar (`images/README.md`). CI: `npm run optimize:images`

## Domain rules (see CONTEXT.md)

- **Issuer** ≠ **Network** (e.g. Scotiabank + Amex)
- Product names (Cobalt, Gold, Platinum) go in `name`, not `network_tier`
- `network_tier` is the network package (`infinite`, `signature`, `world_elite`, `diamond`, `none`, …)
- All perks live in `benefits[]` with `source` and `category`
- Signup Bonus ≠ Rewards ≠ Benefits

## Local commands

```bash
# edit data/us/my-card.json
npm run validate
npm test
npm run optimize:images   # if you added files under images/
```

## PR title cheatsheet

| Kind | Title format |
|------|----------------|
| New card | `Add card: us-my-card` |
| Update card | `Update card: us-my-card` |
| Docs / CI / chore | `docs: …` / `ci: …` / `chore: …` |

## Licenses

- Code: MIT  
- Data you contribute: CC BY 4.0  
- Card artwork: remains bank copyright  
