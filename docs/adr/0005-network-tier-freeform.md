# Network Tier is a free-form global slug, not a closed enum

`network_tier` is a lowercase string with documented conventions (`infinite`, `signature`, `world_elite`, `diamond`, `platinum`, `standard`, `none`, …). JSON Schema does not enumerate an exhaustive closed set. New network packages can be added without a schema major version. Indexes group by exact string match.

For open networks (Visa, Mastercard, UnionPay), the slug reflects the network product package. For closed-loop networks (Amex, Discover), the slug reflects the product’s tier-like packaging when useful, else `none`. Do not encode the network name into the tier string (avoid `visa:infinite`); `network` is a separate field.

**Status:** accepted

**Considered options:** closed JSON Schema enum; hierarchical `network:tier` codes. Rejected because tiers change faster than schema PRs, and hierarchical codes duplicate `network`.
