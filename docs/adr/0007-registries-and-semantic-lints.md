# ADR-0007: Issuer registry, tier allowlist, and semantic lints

Date: 2026-07-24. Status: accepted.

## Context

A review of 187 incoming card PRs found systemic defects that all passed `ajv`
validation: placeholder reward categories in 102 PRs, `network_tier` drift or
errors in 56 (`visa_signature` vs `signature`, `signature_or_platinum`,
marketing names), the same bank under two `issuer_id`s (`fnbo` vs
`first-bankcard`), cash-back rates encoded both as `1.5` and `0.015`, scraped
page titles committed as product names, and null fees for cards with known
fees. `build-indexes.ts` and the Worker API group and filter by raw
`issuer_id` / `network_tier` strings, so vocabulary drift silently splits
indexes and query results.

## Decision

1. **`data/issuers.json`** is the canonical issuer registry. `validate.ts`
   rejects any `issuer_id` not registered, and suggests the canonical id when
   an alias is used. New issuers are added in the same PR as their first card.
2. **`data/network-tiers.json`** is the tier allowlist. ADR-0005's free-form
   field stays (no schema enum), but unknown values fail validation with a
   pointer to extend the allowlist — freedom with a consistency gate.
3. **Semantic lints in `validate.ts`** (placeholder categories, rate-less
   categories, fraction-encoded rates, future dates, fee-currency/country
   mismatch, scraped names, lifecycle coherence, duplicate benefit ids,
   image-URL heuristics, cross-card URL reuse, and committed `local_path`
   files), all
   emitted as GitHub `::error file=` annotations so failures render inline on
   the PR diff.
4. **New optional fields**: `segment` (personal/business/corporate),
   `rewards.rate_type` (unit of `points_per_dollar`), `discontinued_date`,
   `replaced_by`. Optional to keep existing data valid; new cards should set
   `segment` and `rate_type`. A future schema_version bump may require them.

## Consequences

- Registries live under `data/` (not picked up by `listCardFiles`, which only
  reads country subdirectories).
- Contributors get actionable, inline errors instead of a red check with
  buried stderr.
- The 0.015-style encodings, tier drift, and issuer splits observed in the PR
  backlog become impossible to merge.
