# Schema notes

## Network Tier conventions

`network_tier` is a free-form lowercase slug for the **network product package**, not the product marketing name.

| Network | Common tiers |
|---------|----------------|
| Visa | `infinite`, `signature`, `platinum`, `standard`, `none` |
| Mastercard | `world_elite`, `world`, `platinum`, `standard`, `none` |
| UnionPay | `diamond`, `platinum`, `gold`, `standard`, `none` |
| Amex / Discover | usually `none` (product names like Gold/Cobalt go in `name`) |

Issuer and Network are independent. See ADR-0005 and `CONTEXT.md`.

## Benefit categories

`insurance` | `lounge` | `credit` | `waiver` | `acceleration` | `other`

Insurance entries should prefer structured `details` (coverage, duration, deductible, conditions).

## Card Id

`{country}-{slug}` must match the file path `data/{country}/{slug}.json`.

## Registries & semantic lints (2026-07)

`npm run validate` enforces more than the JSON Schema:

- **`issuer_id` registry** — must resolve to an entry in `data/issuers.json`. New issuer? Add it there in the same PR. Known aliases (e.g. `first-bankcard`) are rejected with the canonical id (`fnbo`) suggested.
- **`network_tier` allowlist** — must be one of `data/network-tiers.json`. Bare package slugs only: `infinite`, never `visa_infinite`; one atomic value, never `signature_or_platinum`.
- **No placeholder categories** — `{"label": "Category", "points_per_dollar": null}` fails. A listed bonus category must carry its rate; if the earn detail is genuinely unknown, leave `categories` empty.
- **Whole-number rate convention** — `points_per_dollar: 1.5` means 1.5x points/miles or 1.5% cash back, never `0.015`. Set `rewards.rate_type` (`points_multiplier` | `cashback_percent` | `miles_multiplier`) so consumers can tell which. Sub-0.5 values without an explicit `rate_type` are rejected as suspected fraction encodings.
- **Dates** — `last_verified` / `signup_bonus.as_of` must not be in the future.
- **Fee currency** — must match the market: `us`→USD, `ca`→CAD, `cn`→CNY.
- **Scraped names** — page titles like "Credit Cards: Find & Apply…" are rejected; use the real product name.

## Segment & lifecycle (2026-07)

- `segment`: `personal` | `business` | `corporate`. Optional for now (absent = personal); set it explicitly on new cards, always on business cards.
- `discontinued_date` + `replaced_by`: machine-readable lifecycle. `replaced_by` must reference an existing Card Id; only set `discontinued_date` when `status` is `discontinued`.

## Card art lineage & graduation (2026-07)

- **Graduated art** = `image.local_path` set with `image.provenance.source: "apple-pay"` — the lossless Apple Pay export is the highest-grade card face.
- `provenance.source_sha256` hashes the ORIGINAL export (pre-WebP conversion) so tools can tell "the DB already has exactly this art" without re-uploading; `alternate_sha256[]` lists other exports of the same design (@3x etc.); `converted_sha256` hashes the committed WebP (CI fills it).
- `image.history[]` is append-only: replaced art moves to `images/archive/<id>.<date>.webp` — banks refresh designs and grandfathered cardholders keep theirs, so superseded versions stay addressable.

## Discontinued cards & source tiers (2026-07)

Discontinued cards are **in scope** (grandfathered cardholders exist). Their lifecycle: `status: discontinued` + `discontinued_date` (+ `replaced_by`); the weekly staleness sweep skips them.

Source tiers, enforced by lint:
1. `sources` — official pages only. A **`web.archive.org` snapshot of an official page counts as official** (the allowlist validates the archived inner URL).
2. `secondary_sources` — any domain, permitted **only** on discontinued cards whose official pages are gone; explicitly lower confidence.
