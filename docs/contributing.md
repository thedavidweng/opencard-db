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
5. Set the **PR title** with Conventional Commits — cards use type `card` + scope:
   ```text
   card(add): us-my-card-slug
   ```
   (or `card(update): …` when editing an existing card). Feature/docs/CI PRs use `feat:` / `fix:` / `docs:` / … — see the cheatsheet below.
6. For images: official bank URL when stable, or — **best local mirror** — Apple Pay `cardBackgroundCombined@2x.png` from your Mac Wallet (`images/us-my-card-slug.png` → CI **lossless WebP**, native size). See `images/README.md` and `docs/research/apple-pay-card-art.md`. Do not scrape Apple remotely.
7. Wait for checks:
   - **Validate** — schema / tests
   - **Labels** — classifies the PR (`new-card`, `US`/`CA`/`CN`, `enhancement`, …). Always green.
   - **Form check** — required title + beginner form fields. **Fails** if something is missing, and posts a **sticky PR comment** listing what to fix (Homebrew-style). Also catches:
     - duplicate open card(add|update) PRs for the same card (links the other PR)
     - add vs update mismatches (card already on / missing from main)
     - Update PRs whose **Last verified** is not **newer** than the version on main
   - **Optimize Images** — only if you uploaded a raster under `images/`

If **Form check** is red, expand the sticky comment and follow the numbered fixes — edit **this** PR; don’t open a duplicate.

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

One Conventional Commits system for every PR.

| Kind | Title format |
|------|----------------|
| New card | `card(add): us-my-card` |
| Update card | `card(update): us-my-card` |
| Feature | `feat: …` or `feat(scope): …` |
| Bug fix | `fix: …` |
| Docs | `docs: …` |
| CI / tooling | `ci: …` / `chore: …` / `build: …` |
| Other | `refactor:` / `test:` / `perf:` / `style:` / `revert:` |

Examples: `card(add): us-chase-sapphire-preferred`, `feat(pr-checks): detect duplicate card PRs`, `docs: explain Apple Pay extracts`.

**Do not** use `feat:` for adding a card — reserve type `card` with scope `add` or `update`. Legacy titles `Add card:` / `Update card:` still pass Form check so older open PRs keep working.

**Form check** rejects titles that are not Conventional Commits (wrong spelling of `feat: …`, bare `card:` without scope, etc.).

## Licenses

- Code: MIT  
- Data you contribute: CC BY 4.0  
- Card artwork: remains bank copyright  

## Coverage vs public card lists

`npm run coverage:check` fetches two public card lists at runtime and reports which of
their active cards this DB does not cover yet. Those lists are **discovery references
only** — never `sources`, never copied into the repo (fields, URLs, images, or values).
Every record here is verified against official issuer/network pages instead
(tracking: issue #26).
