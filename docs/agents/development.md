# Data, schema and Worker development

The root is Node data/schema tooling; `worker/` is a separate Cloudflare Worker package serving the optional `/v1` API. Install with `npm ci` at root and `npm ci --prefix worker` for the Worker. Both packages have separately committed lockfiles.

Root tasks from `package.json`: `validate`, `build:indexes`, `test`. Worker tasks: `dev`, `deploy`, `deploy:production`, `types`, `typecheck`. The current [Validate workflow](../../.github/workflows/validate.yml) gates root validate, index build, tests, and root + Worker typecheck (`npm run typecheck` at root).

The Worker uses `worker/cloudflare.config.ts` for `selfhost` (self-host baseline) and `production` (official instance) deployment modes. `Env` types generate into `worker/.cloudflare/types/index.d.ts` via `npm run types --prefix worker`; worker `typecheck` generates them before TypeScript validation. `worker/wrangler.jsonc` remains in use for KV/secret commands.

**Node.js >=24 is required (owner decision A).** The root `package.json` is authoritative; keep setup, agent, development and CI guidance consistent with its engine requirement. Do not lower it. CI uses Node 24.
