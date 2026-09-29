## Agent skills

### Issue tracker

Issues and product specs (PRDs) live in this repo's GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Standard five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. Glossary: `CONTEXT.md`. ADRs: `docs/adr/`. Product spec: [Spec: OpenCard DB v1 production system](https://github.com/thedavidweng/opencard-db/issues/10). See `docs/agents/domain.md`.

### Wayfinding

Active map: [Map: OpenCard DB v1 production system](https://github.com/thedavidweng/opencard-db/issues/1). Resolve at most one wayfinder ticket per session; claim with assignee first.

## Cursor Cloud specific instructions

Two components: the root data/schema tooling (Node 20+, no framework) and the `worker/` Cloudflare Worker (`/v1` API). The startup update script runs `npm ci` (root) and `npm ci --prefix worker` (`worker/package-lock.json` is committed).

- Worker development, deployment, and types use `worker/cloudflare.config.ts`: mode `selfhost` is the self-host baseline and `production` is the official instance. `Env` types are generated into `.cloudflare/types/index.d.ts` by `npm run types --prefix worker`; the worker `typecheck` script regenerates them first. `worker/wrangler.jsonc` remains for KV and secret commands.
- Standard commands are already documented: root scripts in `package.json` (`validate`, `build:indexes`, `test`), worker scripts in `worker/package.json` (`dev`, `deploy`, `deploy:production`, `types`, `typecheck`). CI gates on `validate` + `build:indexes` + `test` only (`.github/workflows/validate.yml`).
- Running the API locally with data (non-obvious): `cf dev --mode selfhost` starts with an empty local KV, so catalog endpoints return 404 `"... not loaded. Deploy indexes to KV."` until you seed KV. Steps: (1) `npm run build:indexes` at root → `dist/indexes/`; (2) start `cf dev --mode selfhost --persist-to <dir>`; (3) load the 7 keys (`meta`, `cards:all`, `cards:by-id`, `index:country|issuer|network|network_tier`) via `cf kv keys put <key> --namespace-id <id-from-cloudflare.config.ts> --file dist/indexes/<file> --local --persist-to <same dir>`. `/v1/health` and `/v1/assets/default-card.webp` work without KV.
- The `cf kv keys put` and `cf dev` invocations must share the same `--persist-to` directory or the dev server won't see the seeded keys.
- Pre-existing (not caused by setup): `npm run typecheck` in `worker/` fails in `src/card-image.ts` (empty-object `{}` fallback loses `CardImage` typing). It is not part of CI and does not block `dev`/`deploy`.
