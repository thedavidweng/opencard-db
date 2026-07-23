# Self-hosting OpenCard DB on Cloudflare Free

You get an unlimited (within **your** Free plan quotas) private API. No paid Cloudflare products required.

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

## Free plan notes

- ~100k Worker requests / day  
- ~100k KV reads / day  
- ~1k KV writes / day (deploys use a handful of keys)  
- Prefer edge caching; do not store rate-limit counters in KV  
