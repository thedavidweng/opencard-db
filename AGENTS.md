# OpenCard DB

Community-maintained credit-card JSON database with validated CDN exports and an optional Cloudflare Worker API.

- Runtime: **Node.js >=24**. The root and `worker/` packages use **npm** with separately committed lockfiles.
- Standard root checks: `npm run validate && npm run build:indexes && npm test`.
- Consult relevant references before changing:
  - [Data/schema/Worker development](docs/agents/development.md).
  - [Local Worker KV setup](docs/agents/local-worker.md).
  - [Domain glossary](CONTEXT.md) and [domain-doc rules](docs/agents/domain.md).
  - [Issue/PRD workflow](docs/agents/issue-tracker.md), [triage labels](docs/agents/triage-labels.md).
- The canonical v1 [product spec](https://github.com/thedavidweng/opencard-db/issues/10) and [project map](https://github.com/thedavidweng/opencard-db/issues/1) are linked for product planning only.
