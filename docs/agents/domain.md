# Domain docs

**Layout:** single-context.

- Root `CONTEXT.md` (when present) is the domain entrypoint.
- Architecture Decision Records live under `docs/adr/` when needed.
- Product design for OpenCard DB v1: `docs/superpowers/specs/2026-07-23-opencard-db-design.md`.

## Consumer rules

Agents should read the design spec before changing schema, API, or deploy paths. Prefer additive changes; do not invent paid Cloudflare features.
