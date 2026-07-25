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
