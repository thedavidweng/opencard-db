# OpenCard DB

Open-source, structured, community-maintainable **credit card product metadata** for **China, the United States, and Canada** — with a free public API path and easy self-hosting on Cloudflare’s free plan.

> **Status:** scaffolding and design. Schema, seed cards, Worker, and CI are in progress via the [wayfinder map](https://github.com/thedavidweng/opencard-db/issues/1).

## What’s in this repo

| Path | Purpose |
|------|---------|
| `data/{us,ca,cn}/` | One JSON file per card (source of truth) |
| `schema.json` | Strict JSON Schema contract (upcoming) |
| `scripts/` | Validate data + build KV indexes |
| `worker/` | Cloudflare Worker serving `/v1` |
| `tests/` | Schema / index / API contract tests |
| `docs/` | API, self-host, contributing, design |

## Design

- **Spec (PRD):** [Spec: OpenCard DB v1 production system](https://github.com/thedavidweng/opencard-db/issues/10)
- **Glossary:** [`CONTEXT.md`](CONTEXT.md)
- **ADRs:** [`docs/adr/`](docs/adr/)

## Licenses

- **Code** (Worker, scripts, workflows): [MIT](LICENSE)
- **Data** (`data/**`): [CC BY 4.0](LICENSE-DATA) — attribution required
- **Images:** bank copyright; see [`images/README.md`](images/README.md)

## Quick local commands

```bash
npm run validate        # schema + id checks (when scripts land)
npm run build:indexes   # build bulk KV artifacts into dist/
npm test
```

## Contributing

Data changes only via GitHub Pull Requests. Prefer one card per PR with official `sources` and a recent `last_verified`. Details will live in `docs/contributing.md`.

## Free API vs self-host

The official free instance (when deployed) is rate-limited and requires a meaningful client identifier. **Production or high-volume use must self-host** on your own Cloudflare free plan — see `docs/self-hosting.md` (upcoming).

## Map

Implementation tracking: [Map: OpenCard DB v1 production system](https://github.com/thedavidweng/opencard-db/issues/1)
