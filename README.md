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
| `scripts/` | Validate, indexes, PR triage, image optimize |
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
- **Images:** bank copyright — see [`images/README.md`](images/README.md)

## Status

Implementation map: [Map: OpenCard DB v1 production system](https://github.com/thedavidweng/opencard-db/issues/1)
