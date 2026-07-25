# OpenCard DB

[![Validate](https://github.com/thedavidweng/opencard-db/actions/workflows/validate.yml/badge.svg)](https://github.com/thedavidweng/opencard-db/actions/workflows/validate.yml)
[![Release](https://img.shields.io/github/v/release/thedavidweng/opencard-db)](https://github.com/thedavidweng/opencard-db/releases)
[![Cards](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fcdn.jsdelivr.net%2Fgh%2Fthedavidweng%2Fopencard-db%40main%2Fexports%2Fmeta.json&query=%24.card_count&label=cards&color=0a7)](exports/meta.json)
[![Code: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Data: CC BY 4.0](https://img.shields.io/badge/data-CC%20BY%204.0-lightgrey.svg)](LICENSE-DATA)

A community-maintained database of credit card products in the United States, Canada, and China. Every card is a single JSON file validated against a schema, published as static exports on a free CDN, and served through an optional Cloudflare Workers API.

Website: [thedavidweng.github.io/opencard-db](https://thedavidweng.github.io/opencard-db/)

- One JSON file per card under [`data/`](data), reviewed through pull requests
- Exports in JSON, CSV, and YAML, rebuilt automatically on every merge
- Live counts in [`exports/meta.json`](exports/meta.json) (189 cards across 3 countries at the time of writing)
- No signup, no API key, no rate limits on the CDN path

## Getting the data

### CDN (recommended for production)

Pin a release tag on jsDelivr. Tagged URLs never change and are served from a global CDN with no quotas:

```
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.2.0/exports/cards-all.json
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.2.0/exports/cards.csv
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.2.0/exports/meta.json
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.2.0/exports/index-country.json
```

The same files are attached to every [GitHub Release](https://github.com/thedavidweng/opencard-db/releases) as downloadable assets. The full list of exports (7 index JSONs plus `cards.csv` and `cards.yaml`) lives in the committed [`exports/`](exports/) directory. Releases, changelogs, and version bumps are automated; see [`docs/RELEASING.md`](docs/RELEASING.md).

### Latest data

`@main` always points at the newest merged data. jsDelivr caches branch URLs for about 12 hours, so use this for prototyping rather than production:

```
https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@main/exports/cards-all.json
https://raw.githubusercontent.com/thedavidweng/opencard-db/main/exports/cards-all.json
```

`exports/` is refreshed automatically on every push to `main` that touches the data, schema, or build scripts.

### REST API

A read-only HTTP API with filtering, search, and per-card lookup, served from `https://opencard-db.davidweng.workers.dev`:

```http
GET /v1/health
GET /v1/meta
GET /v1/cards?country=us
GET /v1/cards/us-chase-sapphire-preferred
GET /v1/search?q=sapphire
```

The official instance is best effort: it requires a meaningful `User-Agent` or `X-Client-Name` header and is rate limited to 30 requests per minute and 500 per day per IP. For production traffic, deploy your own instance on the Cloudflare free plan. See [`docs/api.md`](docs/api.md), [`docs/openapi.yaml`](docs/openapi.yaml), and [`docs/self-hosting.md`](docs/self-hosting.md).

## What a card looks like

Each record covers fees, APR ranges, rewards structure, FX fees, credit requirements, and sourcing. A trimmed example:

```json
{
  "id": "us-chase-sapphire-preferred",
  "name": "Chase Sapphire Preferred® Card",
  "country": "us",
  "issuer": "Chase",
  "network": "visa",
  "network_tier": "signature",
  "type": "credit",
  "status": "active",
  "annual_fee": { "amount": 95, "currency": "USD" },
  "fx_fee": { "percent": 0 },
  "rewards": {
    "currency_label": "Ultimate Rewards points",
    "base_rate": { "points_per_dollar": 1 },
    "categories": [
      { "label": "Travel booked through Chase Travel", "points_per_dollar": 5 },
      { "label": "Dining including eligible delivery services", "points_per_dollar": 3 }
    ]
  }
}
```

The full contract is [`schema.json`](schema.json), with field-level notes in [`docs/schema-notes.md`](docs/schema-notes.md).

## Card art

Issuer artwork stays the copyright of the issuing bank. Cards without a face fall back to a generic placeholder in the API (see [`images/README.md`](images/README.md)).

Every exported card carries a derived `art_grade` describing the quality of its card face, computed at build time:

| Grade | Meaning |
|-------|---------|
| `apple-pay` | A committed local card face with Apple Pay provenance and SHA lineage. The highest grade. |
| `issuer` | Official issuer-site artwork without Apple Pay provenance. |
| `none` | No card face. Consumers fall back to the placeholder. |

Catalog-wide counts live in [`exports/meta.json`](exports/meta.json) under `art_grades`. The lineage model is documented in [`docs/schema-notes.md`](docs/schema-notes.md#card-art-lineage--graduation-2026-07).

On a Mac with your cards in Apple Pay, [`npx opencard-export`](packages/opencard-export) scans your Wallet, compares it against the live database, and helps you open a PR with Apple Pay card art. Everything runs locally and nothing is uploaded.

## Contributing

Contributions welcome, whether it is a new card, a data correction, or card art. Start with [`docs/contributing.md`](docs/contributing.md) ([中文版](docs/contributing.zh-Hans.md)). The short version:

1. Copy [`templates/card.template.json`](templates/card.template.json) into `data/{country}/`
2. Fill in the fields and cite your sources
3. Run `npm run validate`
4. Open a pull request

CI validates the schema, checks sources, and labels the PR automatically. Reviewers follow [`docs/REVIEWING.md`](docs/REVIEWING.md).

## Development

```bash
git clone https://github.com/thedavidweng/opencard-db.git
cd opencard-db
npm ci
npm run validate
npm test
npm run build:indexes   # writes dist/indexes/
```

## Repository layout

| Path | Purpose |
|------|---------|
| `data/{us,ca,cn}/` | One JSON file per card (system of record) |
| `schema.json` | JSON Schema contract |
| `templates/` | Starter card JSON for new contributions |
| `exports/` | Committed catalog exports served by the CDN paths |
| `scripts/` | Validation, index builds, PR checks, image optimization |
| `images/` | Optional local card-face mirrors (converted to WebP in CI) |
| `worker/` | Cloudflare Worker `/v1` API |
| `packages/opencard-export/` | Apple Pay wallet export CLI |
| `tests/` | Schema, index, API, and PR contract tests |
| `docs/` | API reference, self-hosting, contributing, ADRs |

## Design docs

| Artifact | Role |
|----------|------|
| [Spec: OpenCard DB v1](https://github.com/thedavidweng/opencard-db/issues/10) | Product PRD |
| [Map: OpenCard DB v1 production system](https://github.com/thedavidweng/opencard-db/issues/1) | Implementation map |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary |
| [`docs/adr/`](docs/adr/) | Architecture decisions |

## License

- Code: [MIT](LICENSE)
- Data (`data/**`): [CC BY 4.0](LICENSE-DATA)
- Card images: issuer artwork remains the copyright of the respective banks

## Disclaimer

Community-maintained data can contain errors or lag behind issuer changes. Always verify terms on the issuer's site before making financial decisions. Found a mistake? [Open an issue](https://github.com/thedavidweng/opencard-db/issues).
