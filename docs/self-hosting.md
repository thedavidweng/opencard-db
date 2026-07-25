# Self-hosting OpenCard DB on Cloudflare Free

You get an unlimited (within **your** Free plan quotas) private API. No paid Cloudflare products required.

> **Don't need an API?** If you only need to read the catalog, skip the Worker
> entirely. The committed [`exports/`](../exports/) directory holds the full
> generated catalog (7 index JSONs plus `cards.csv` and `cards.yaml`). Vendor it
> into your app, or serve it straight from a global CDN with zero quota via a
> tag-pinned jsDelivr URL:
> `https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.1.0/exports/cards-all.json`.
> See the [README "Get the data"](../README.md#get-the-data) section. Run the
> Worker only when you need server-side filtering, search, or per-card lookup.

## Prerequisites

- Cloudflare account (Free)
- Node.js 20+
- This repository

## 1. Create a KV namespace

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create OPENCARD_KV
```

Copy the namespace id into `worker/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "OPENCARD_KV"
id = "<your-namespace-id>"
```

## 2. Build and upload indexes

From the repo root:

```bash
npm ci
npm run validate
npm run build:indexes
```

Upload keys (few bulk keys only — fits Free write budget):

```bash
export CLOUDFLARE_API_TOKEN=…
export CLOUDFLARE_ACCOUNT_ID=…
export KV_NAMESPACE_ID=<your-namespace-id>
npx wrangler kv key put meta --path dist/indexes/meta.json --namespace-id $KV_NAMESPACE_ID --remote
npx wrangler kv key put cards:all --path dist/indexes/cards-all.json --namespace-id $KV_NAMESPACE_ID --remote
npx wrangler kv key put cards:by-id --path dist/indexes/cards-by-id.json --namespace-id $KV_NAMESPACE_ID --remote
npx wrangler kv key put index:country --path dist/indexes/index-country.json --namespace-id $KV_NAMESPACE_ID --remote
npx wrangler kv key put index:issuer --path dist/indexes/index-issuer.json --namespace-id $KV_NAMESPACE_ID --remote
npx wrangler kv key put index:network --path dist/indexes/index-network.json --namespace-id $KV_NAMESPACE_ID --remote
npx wrangler kv key put index:network_tier --path dist/indexes/index-network-tier.json --namespace-id $KV_NAMESPACE_ID --remote
```

Or run `node --experimental-strip-types scripts/upload-kv.ts` after setting the env vars.

## 3. Deploy the Worker

```bash
cd worker
# Self-host defaults: MODE=selfhost, rate limits off
npx wrangler deploy
```

> **A fresh deploy returns 404 until KV is seeded.** `/v1/health` and
> `/v1/assets/default-card.webp` work immediately, but the catalog endpoints
> (`/v1/meta`, `/v1/cards`, `/v1/search`, `/v1/indexes/*`) respond `404
> "... not loaded. Deploy indexes to KV."` until the keys from step 2 exist in
> the namespace. If you deployed before seeding (or against an empty
> namespace), build and upload the indexes:
>
> ```bash
> npm run build:indexes          # from the repo root → dist/indexes/
> export CLOUDFLARE_API_TOKEN=…
> export CLOUDFLARE_ACCOUNT_ID=…
> export KV_NAMESPACE_ID=<your-namespace-id>
> node --experimental-strip-types scripts/upload-kv.ts
> ```

## 4. Optional: official-style policy on your instance

In `wrangler.toml`:

```toml
[vars]
MODE = "official"
REQUIRE_CLIENT_ID = "true"
RATE_LIMIT_ENABLED = "true"
RATE_LIMIT_PER_MINUTE = "30"
RATE_LIMIT_PER_DAY = "500"
CACHE_MAX_AGE = "300"
```

## GitHub Actions secrets (optional official deploy)

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers + KV edit |
| `CLOUDFLARE_ACCOUNT_ID` | Account id |
| `KV_NAMESPACE_ID` | Target KV namespace |

If secrets are missing, the deploy workflow validates and builds indexes, then **exits successfully without uploading**.

## Caching and the free tier

The Worker caches successful `/v1` JSON responses in the Cache API
(`caches.default`). A cache hit skips the KV read and the JSON parse of the full
catalog blob, cutting KV reads and CPU on repeat requests. This cache is
**per-colo**: each Cloudflare data center keeps its own copy, so the first
request to each colo is still a miss.

Important on `*.workers.dev`: caching does **not** reduce Worker invocations.
Every request — cache hit or miss — still counts as one Worker request against
your daily quota. To actually offload requests from the Worker (serve them from
Cloudflare's edge cache without invoking the script), put the Worker on a
**custom domain** and add a **Cache Rule** for `/v1/*`. That is the only way to
turn repeat hits into zero Worker invocations.

## Free plan notes

- ~100k Worker requests / day (every request counts, even cache hits)  
- ~100k KV reads / day (per-colo response cache reduces these on repeat hits)  
- ~1k KV writes / day (deploys use a handful of keys)  
- Rate-limit counters live in the Cache API, never in KV, to preserve the write budget  
