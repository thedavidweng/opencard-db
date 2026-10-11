# Run the Worker against local KV data

`cf dev --mode selfhost` starts with empty local KV; catalog endpoints return a "not loaded. Deploy indexes to KV." 404 until indexes are seeded. `/v1/health` and `/v1/assets/default-card.webp` do not need seeding.

1. `npm run build:indexes` in the root; generated files go under `dist/indexes/`.
2. With the dev server stopped, from `worker/`, load seven KV keys using `npx cf kv keys put <key> --namespace-id <selfhost-id-from-cloudflare.config.ts> --file ../dist/indexes/<matching-file> --local --persist-to <dir>`.
3. From `worker/`, start `npx cf dev --mode selfhost`.
4. The dev-server and `cf kv keys put` invocations MUST use the same persistence directory. Use an absolute path for `<dir>`.

The current mapping from [scripts/build-indexes.ts](../../scripts/build-indexes.ts) is:

| KV key | File under `dist/indexes/` |
| --- | --- |
| `meta` | `meta.json` |
| `cards:all` | `cards-all.json` |
| `cards:by-id` | `cards-by-id.json` |
| `index:country` | `index-country.json` |
| `index:issuer` | `index-issuer.json` |
| `index:network` | `index-network.json` |
| `index:network_tier` | `index-network-tier.json` |

When reproducing issues, cite the exact key-to-file mapping from the current index-generation source instead of guessing mappings.

The pinned cf beta.13 consumes `cf dev --mode selfhost --persist-to <dir>` without forwarding the persistence option; its Wrangler delegate does not support that flag either. For this version, `<dir>` MUST be the absolute path to `worker/.wrangler/state`, the dev server's default. Seed that directory, then run `cf dev --mode selfhost`. Re-check custom-directory support when upgrading cf.
