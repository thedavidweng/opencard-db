# Network Tier is a free-form global slug, not a closed enum

`network_tier` is a lowercase string with documented conventions for **network packages** (`infinite`, `signature`, `world_elite`, `world`, `diamond`, `platinum` for UnionPay-style packages, `standard`, `none`, …). JSON Schema does not use an exhaustive closed enum. New network packages can be added without a schema major version. Indexes group by exact string match.

**Issuer and Network are independent fields.** Amex and Discover are networks (发卡组织). The issuing bank is always recorded separately. Examples:

- Amex-issued Amex Card → `issuer_id=amex`, `network=amex`, `network_tier` usually `none` (unless a true network package applies).
- Scotiabank-issued Amex Card → `issuer_id=scotiabank`, `network=amex`, `network_tier` usually `none`.

**Product names are not Network Tiers.** Cobalt, Gold, Platinum, Sapphire Preferred, etc. belong in the Card `name` (and slug), not in `network_tier`.

Do not encode the network name into the tier string (avoid `visa:infinite`); `network` is a separate field.

**Status:** accepted

**Considered options:** closed JSON Schema enum; hierarchical `network:tier` codes; using product line names (Gold/Cobalt) as Network Tier for Amex. Rejected: enums lag reality; hierarchical codes duplicate `network`; product names are not network packages.
