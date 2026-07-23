# Benefits array is the authoritative perk inventory

Every named perk on a Card is a Benefit in a single `benefits` array, with `source` (`network` | `issuer` | `co-brand`) and `category` (including `insurance` for all insurance products). Insurance entries should use structured `details` (coverage, duration, deductible, conditions) rather than prose alone. High-frequency travel fields may be mirrored in `travel_perks` for query convenience, but that object is not a second source of truth.

Signup Bonus and Rewards earn structure are not Benefits.

**Status:** accepted

**Why:** Comparison and filtering need a uniform inventory (“all insurance”, “all network-sourced lounge access”) without US-centric top-level fields for every perk shape. Structured `details` absorbs insurer-specific variance without exploding the schema.
