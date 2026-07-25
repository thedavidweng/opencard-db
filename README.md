# OpenCard DB

Open-source, structured, community-maintainable **credit card product metadata** for **China, the United States, and Canada** — with a free public API path and easy self-hosting on Cloudflare Free.

## Quick start

```bash
git clone https://github.com/thedavidweng/opencard-db.git
cd opencard-db
npm ci
npm run validate
npm test
npm run build:indexes   # writes dist/indexes/
```

Browse Cards offline under `data/{us,ca,cn}/`.

## Get the data

Three consumption tiers, from most to least production-ready. The generated
catalog lives in the committed [`exports/`](exports/) directory (7 index JSONs
plus `cards.csv` and `cards.yaml`), which is what the static CDN paths serve.

### (a) Production (recommended): jsDelivr, tag-pinned & immutable

Pin a release tag. These URLs are **immutable** and served from a global CDN
with **no rate limits and no quota** — the recommended path for production:

```
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.1.0/exports/cards-all.json
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.1.0/exports/cards.csv
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.1.0/exports/meta.json
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.1.0/exports/index-country.json
```

Each `v*` tag also ships a **GitHub Release** with the same files attached as
downloadable assets.

### (b) Preview / dev: `@main` (mutable, ~12h stale)

Track the latest merged data. Convenient for prototyping, **not** for
production — jsDelivr caches branch URLs for ~12h and `raw` is uncached but
best-effort:

```
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@main/exports/cards-all.json
https://raw.githubusercontent.com/thedavidweng/opencard-db/main/exports/cards-all.json
```

`exports/` is auto-refreshed on every push to `main` that touches the data,
schema, or build scripts.

### (c) The `/v1` Worker API

A read-only HTTP API with filtering, search, and per-card lookup. **Self-host
for production** (Cloudflare Free, your own quotas). The official instance is
**best-effort only**: it requires client identification and is rate-limited
(30/min, 500/day per IP). See [`docs/api.md`](docs/api.md) and
[`docs/openapi.yaml`](docs/openapi.yaml).

## Design docs

| Artifact | Role |
|----------|------|
| [Spec: OpenCard DB v1](https://github.com/thedavidweng/opencard-db/issues/10) | Product PRD |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary |
| [`docs/adr/`](docs/adr/) | Architecture decisions |
| [`docs/api.md`](docs/api.md) | HTTP API |
| [`docs/self-hosting.md`](docs/self-hosting.md) | Deploy on your Cloudflare Free plan |
| [`docs/contributing.md`](docs/contributing.md) | Add or update Cards |

## Repository layout

| Path | Purpose |
|------|---------|
| `data/{us,ca,cn}/` | One JSON file per Card (system of record) |
| `templates/card.template.json` | Beginner starter Card JSON |
| `schema.json` | JSON Schema contract |
| `scripts/` | Validate, indexes, PR Labels / Form check, image optimize |
| `images/` | Optional local card-face mirrors (CI → WebP) |
| `worker/` | Cloudflare Worker `/v1` API |
| `tests/` | Schema, index, API, and PR UX contract tests |

## API (self-host or official)

```http
GET /v1/health
GET /v1/meta
GET /v1/cards?country=us
GET /v1/cards/us-chase-sapphire-preferred
GET /v1/search?q=sapphire
```

Official free instance (when deployed): requires a meaningful `User-Agent` or `X-Client-Name`, rate-limited (30/min, 500/day per IP). **Production traffic must self-host.**

## Licenses

- **Code:** [MIT](LICENSE)
- **Data** (`data/**`): [CC BY 4.0](LICENSE-DATA)
- **Images:** optional; issuer art stays bank copyright. Missing faces use a generic OpenCard placeholder via the API — see [`images/README.md`](images/README.md)

**Contribute card art in one command:** on a Mac with the card in Apple Pay, run
[`npx opencard-export`](packages/opencard-export) — it scans your Wallet, compares
against the live DB, and helps you open a PR. Everything runs locally; nothing is
uploaded.

## Status

Implementation map: [Map: OpenCard DB v1 production system](https://github.com/thedavidweng/opencard-db/issues/1)
