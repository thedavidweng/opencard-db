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
