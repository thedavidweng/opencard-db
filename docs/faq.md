# FAQ: Common validation errors

`npm run validate` (the **Validate** check) runs the JSON Schema plus a set of
semantic lints. When it fails it prints one `error: <file>: <message>` line per
problem. Find your message below for what it means and the exact fix.

Run it locally before pushing:

```bash
npm run validate
```

---

## `id "…" does not match path-derived id "…"`

**Means:** the `id` field doesn't equal `{country}-{slug}` derived from the file path.
`data/us/my-card.json` must contain `"id": "us-my-card"`.

**Fix:** make `id` exactly `{directory}-{filename-without-.json}`, or rename the file
so they agree. The id is stable forever once merged — pick it carefully.

## `country "…" does not match directory "…"`

**Means:** the `country` field disagrees with the folder the file lives in
(`data/ca/…` must have `"country": "ca"`).

**Fix:** set `country` to the directory code, or move the file into the right
`data/<country>/` folder.

## `issuer_id "…" is not in data/issuers.json — add the issuer there in this PR (id, name, aliases)`

**Means:** `issuer_id` must be a registered issuer. Unknown issuers are rejected so
the same bank always uses one canonical slug.

**Fix:** add an entry (`id`, `name`, optional `aliases`) to `data/issuers.json` in the
**same PR**, then use that `id` here.

## `issuer_id "…" is a known alias — use canonical "…"`

**Means:** the slug you used is registered as an *alias* of another issuer id.

**Fix:** replace your `issuer_id` with the canonical id the message quotes.

## `network_tier "…" is not in data/network-tiers.json — fix the tier, or extend the allowlist in the same PR if it is a real network package`

**Means:** `network_tier` must be a known network **package** slug (`infinite`,
`signature`, `world_elite`, `diamond`, `none`, …) — not a product name.

**Fix:** use the correct package slug. Product marketing names (Cobalt, Gold, Sapphire
Preferred) go in `name`, never `network_tier`. If it's a genuinely new package,
add it to `data/network-tiers.json` in the same PR.

## `network_tier "…" is network-prefixed — the network lives in its own field; use "…"`

**Means:** you embedded the network in the tier (e.g. `visa_signature`).

**Fix:** use the bare slug the message quotes (`signature`); the network stays in the
separate `network` field.

## `network_tier "…" must not embed the network (use the bare package slug)`

**Means:** the tier contains a `:` (e.g. `visa:infinite`).

**Fix:** drop the network prefix — just `infinite`. `network` is its own field.

## `rewards.categories[N] is an unfilled placeholder (label "…") — fill the real bonus category or remove the entry`

**Means:** a bonus category still has a placeholder/empty label (like `Category 1`).

**Fix:** replace it with the real bonus category, or delete the entry if the card has
no such category.

## `rewards.categories[N] ("…") has no points_per_dollar — a listed bonus category must carry its rate`

**Means:** a named bonus category is missing its earn rate.

**Fix:** set `points_per_dollar` for that category (the multiplier the issuer
advertises), or remove the category if it doesn't earn a bonus.

## `rewards rate 0.x looks like a fraction-encoded percentage — use the whole-number convention (1.5 means 1.5% / 1.5x), or set rewards.rate_type explicitly if a sub-0.5 multiplier is real`

**Means:** a rate below `0.5` looks like `0.015` (i.e. 1.5% written as a fraction).

**Fix:** use the whole-number convention — `1.5` means 1.5% / 1.5×. Only if a genuine
sub-0.5 multiplier is intended, set `rewards.rate_type` explicitly.

## `last_verified "…" is in the future`

**Means:** `last_verified` (or `signup_bonus.as_of`) is a date after today.

**Fix:** use the date you actually checked the official pages — today or earlier,
`YYYY-MM-DD`.

## `annual_fee.currency "…" does not match country "…" (expected …)`

**Means:** the fee currency must match the market: `us`→`USD`, `ca`→`CAD`, `cn`→`CNY`.

**Fix:** set `annual_fee.currency` to the expected code the message quotes.

## `schema invalid — … must NOT have additional properties`

**Means:** an unknown/misspelled key exists. The schema is strict
(`additionalProperties: false`) — every field must be one defined in
[`schema.json`](../schema.json). The path before the message points at the offending
object.

**Fix:** remove or rename the stray key. Watch for typos and fields that belong under
a different object.

## `schema invalid — / must have required property 'sources'` (or `/sources must NOT have fewer than 1 items`)

**Means:** `sources` is missing or empty. At least one **official** issuer/network URL
is required.

**Fix:** add the product page and/or terms page URL(s) to the `sources` array (and
`official_url`). Blogs and third-party databases don't count as sources.

## `image.url looks like Getty stock photography` / `social/OG banner` / `Open Graph share image` / `award badge`

**Means:** the URL is marketing chrome (stock photo, social banner, OG share
image, award ribbon), not isolated card art.

**Fix:** replace it with the product-page card face, or set `image.url` to
`null`. Wrong art is worse than no art — the API will serve the generic
fallback.

## `image.url is also used by …`

**Means:** two different Card Ids point at the same image URL. That is almost
always a paste error (one product's face reused on another).

**Fix:** give each card its own official face, or null the extras. Only if the
issuer really prints the same plastic for those variants, add the Card Ids to
`SHARED_ART_FAMILIES` in `scripts/validate.ts` in the same PR.

---

Still stuck? Re-read the [domain rules](contributing.md) and
[CONTEXT.md](../CONTEXT.md), or open a **Report incorrect data** / discussion issue.
