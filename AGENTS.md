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

Two components: the root data/schema tooling (Node 20+, no framework) and the `worker/` Cloudflare Worker (`/v1` API). The startup update script runs `npm ci` (root) and `npm ci --prefix worker` (`worker/package-lock.json` is committed; the old `--legacy-peer-deps` ERESOLVE workaround died with the `@cloudflare/workers-types` dependency, which was replaced by `wrangler types`).

- Worker config is `worker/wrangler.jsonc`: top level is the self-host baseline, `env.production` is the official instance. `Env` types are generated from it into `worker-configuration.d.ts` (gitignored) by `npm run types --prefix worker`; the worker `typecheck` script regenerates them first.
- Standard commands are already documented: root scripts in `package.json` (`validate`, `build:indexes`, `test`), worker scripts in `worker/package.json` (`dev`, `deploy`, `deploy:production`, `types`, `typecheck`). CI gates on `validate` + `build:indexes` + `test` only (`.github/workflows/validate.yml`).
- Running the API locally with data (non-obvious): `wrangler dev` starts with an empty local KV, so catalog endpoints return 404 `"... not loaded. Deploy indexes to KV."` until you seed KV. Steps: (1) `npm run build:indexes` at root → `dist/indexes/`; (2) start `wrangler dev` with an explicit `--persist-to <dir>`; (3) load the 7 keys (`meta`, `cards:all`, `cards:by-id`, `index:country|issuer|network|network_tier`) via `wrangler kv key put <key> --path dist/indexes/<file> --binding OPENCARD_KV --local --persist-to <same dir>`. `/v1/health` and `/v1/assets/default-card.webp` work without KV.
- The `kv key put` and `wrangler dev` invocations must share the same `--persist-to` directory or the dev server won't see the seeded keys.
- Pre-existing (not caused by setup): `npm run typecheck` in `worker/` fails in `src/card-image.ts` (empty-object `{}` fallback loses `CardImage` typing). It is not part of CI and does not block `dev`/`deploy`.
