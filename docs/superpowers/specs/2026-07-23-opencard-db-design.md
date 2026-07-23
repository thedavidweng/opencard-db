# OpenCard DB — Design Specification

**Date:** 2026-07-23  
**Status:** Draft for review  
**Repo:** `opencard-db`  
**Scope:** Complete production system (schema, data, CI, Worker API, self-host path, contribution workflow). No live official Cloudflare deploy in this phase.

---

## 1. Problem & goals

There is no high-quality, open-source, structured, community-maintainable database + queryable API for credit card product metadata covering China, the United States, and Canada. Commercial APIs are paid, US-centric, and closed.

**OpenCard DB** provides:

- GitHub as the single source of truth (one JSON file per card, strict JSON Schema).
- Automated validation and deploy-to-KV pipeline (GitHub Actions).
- Cloudflare Workers + KV serving layer for a free public API and easy self-hosting.
- PR-only contributions with mandatory source attribution and verification dates.
- Multi-country data (CN / US / CA first), bilingual fields where relevant, network tiers as first-class global concepts.

**Non-goals (out of scope):** bank scraping as primary source; full BIN databases; account/transaction data; public write API; paid tiers; countries beyond CN/US/CA in the initial release (schema must allow expansion).

---

## 2. Locked decisions (from product discussion)

| Topic | Decision |
|-------|----------|
| Official instance deploy | **Code + CI only** this phase. Workflows use secrets; if secrets missing, deploy job validates + builds artifacts and skips KV upload / Worker publish cleanly. |
| Cost | **Cloudflare Free only** ($0). Architecture and rate limits sized to free quotas. |
| Rate limits (official mode) | **30 req/min** and **500 req/day** per IP; required meaningful `User-Agent` or `X-Client-Name`; **429 + `Retry-After`**. |
| Serving storage | **Pre-aggregated KV keys** (few bulk keys), not one key per card. |
| Repo layout | **Flat monorepo:** `schema.json`, `data/`, `worker/`, `scripts/`, `.github/workflows/`, `docs/`. |
| Seed data | **Official bank pages only** as authority. Open-source datasets may be used as *clues*, never as final source. 6–9 gold-standard cards first. |
| Contribution | **GitHub PRs only**; prefer one card per PR; `sources` + `last_verified` mandatory. |
| License | Code **MIT**; data **CC-BY-4.0**; images remain bank copyright. |

### Cloudflare Free quotas (design constraints)

| Resource | Free limit | Design implication |
|----------|------------|-------------------|
| Worker requests | 100,000 / day | Rate limits + edge caching |
| KV reads | 100,000 / day | Prefer 1 read per request |
| KV writes | 1,000 / day | Bulk keys; deploy must not write thousands of keys |
| KV storage | 1 GB | Sufficient for card JSON for years |

---

## 3. Architecture

```
GitHub repository (source of truth)
  data/{us,ca,cn}/*.json
  schema.json
        │
        │  PR → validate workflow
        │  merge to main → validate + build indexes
        │                 (+ optional KV sync / worker deploy if secrets set)
        ▼
  scripts/validate.ts
  scripts/build-indexes.ts  →  dist/indexes/*.json
        │
        ▼
  Cloudflare KV (few keys)
        │
        ▼
  Cloudflare Worker  (/v1/*)
        • client identification
        • rate limiting (official mode)
        • Cache-Control
        • JSON API
```

### Component responsibilities

| Component | Responsibility | Does not do |
|-----------|----------------|-------------|
| `data/**/*.json` | Human-verified card facts | Runtime serving logic |
| `schema.json` | Structural contract | Business rules beyond structure |
| `scripts/validate` | Schema + uniqueness + ID/path consistency | Network I/O |
| `scripts/build-indexes` | Produce bulk artifacts for KV | API routing |
| GitHub Actions | Gate PRs; build; optional deploy | Manual data edits |
| Worker | Read KV, enforce policy, return HTTP contract | Mutate card data |
| Docs | API, CONTRIBUTING, self-host, free-tier policy | — |

### Data flow (read path)

1. Client `GET /v1/cards?country=us` with `User-Agent: MyApp/1.0`.
2. Worker checks client ID → rate limit → cache headers path.
3. Worker reads `index:country` (or `cards:all` / `cards:by-id` depending on route).
4. Filters in memory when needed; returns JSON.

### Data flow (write path)

1. Contributor opens PR with one card JSON + sources.
2. `validate` workflow fails the PR on schema or ID errors.
3. Maintainer merges to `main`.
4. Deploy workflow rebuilds all indexes and, if secrets exist, writes bulk keys to KV.

---

## 4. Repository layout

```
opencard-db/
├── schema.json                 # JSON Schema (draft 2020-12)
├── data/
│   ├── us/
│   │   └── chase-sapphire-preferred.json
│   ├── ca/
│   │   └── amex-cobalt.json
│   └── cn/
│       └── cmb-classic-platinum.json
├── images/                     # optional local mirrors (Git LFS if used)
│   └── README.md               # bank copyright + removal policy
├── worker/
│   ├── src/
│   │   ├── index.ts            # router + handlers
│   │   ├── rate-limit.ts
│   │   ├── client-id.ts
│   │   └── types.ts
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
├── scripts/
│   ├── validate.ts
│   ├── build-indexes.ts
│   └── package.json
├── tests/
│   ├── schema/
│   ├── indexes/
│   └── api/                    # contract tests (observable HTTP)
├── .github/
│   ├── workflows/
│   │   ├── validate.yml
│   │   └── deploy.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── docs/
│   ├── api.md
│   ├── self-hosting.md
│   ├── contributing.md
│   └── superpowers/specs/…
├── README.md
├── LICENSE                     # MIT (code)
├── LICENSE-DATA                # CC-BY-4.0 (data)
└── package.json                # root workspaces or simple scripts
```

Stable card file name = card `id` without country prefix collision: file is `{slug}.json` under `data/{country}/`; full public id is `{country}-{slug}` (e.g. `us-chase-sapphire-preferred`). **IDs never change** once published.

---

## 5. Schema design

`schema_version` starts at `"1.0.0"`. Additive fields only in minor/patch; breaking changes require major bump and API dual-read only if ever needed (not in v1).

### Core object (conceptual)

```json
{
  "id": "us-chase-sapphire-preferred",
  "schema_version": "1.0.0",
  "name": "Chase Sapphire Preferred® Card",
  "localized_names": { "en": "…", "zh-Hans": "…" },
  "country": "us",
  "issuer": "Chase",
  "issuer_id": "chase",
  "network": "visa",
  "network_tier": "signature",
  "type": "credit",
  "status": "active",
  "annual_fee": { "amount": 95, "currency": "USD", "first_year": 95, "waiver_conditions": null },
  "apr": { "purchase": { "min": 19.99, "max": 28.99, "type": "variable" }, "notes": "…" },
  "fx_fee": { "percent": 0, "notes": "No foreign transaction fees" },
  "credit_required": { "score_band": "good_to_excellent", "notes": "…" },
  "rewards": {
    "currency": "ultimate_rewards",
    "currency_label": "Ultimate Rewards points",
    "structure": "multi",
    "base_rate": { "points_per_dollar": 1, "description": "…" },
    "categories": [
      {
        "label": "Travel booked through Chase Travel",
        "points_per_dollar": 5,
        "cap": null
      }
    ],
    "redemption_notes": "…"
  },
  "signup_bonus": {
    "amount": 60000,
    "unit": "points",
    "spend_required": 4000,
    "spend_currency": "USD",
    "months": 3,
    "description": "…",
    "as_of": "2026-07-23"
  },
  "benefits": [
    {
      "id": "trip-cancellation",
      "category": "insurance",
      "title": "Trip Cancellation/Interruption Insurance",
      "description": "…",
      "source": "issuer",
      "network_tier_min": null
    }
  ],
  "travel_perks": {
    "lounge_access": { "program": null, "visits_per_year": null, "notes": "…" },
    "tsa_precheck_credit": { "amount": null, "currency": null, "period": null },
    "global_entry_credit": { "amount": null, "currency": null, "period": null },
    "free_checked_bags": null,
    "hotel_status": null,
    "other": []
  },
  "official_url": "https://…",
  "image": {
    "url": "https://…official…",
    "attribution": "© JPMorgan Chase Bank, N.A.",
    "local_path": null
  },
  "bin_hints": [],
  "last_verified": "2026-07-23",
  "sources": [
    "https://creditcards.chase.com/…",
    "https://…terms…"
  ],
  "notes": ""
}
```

### Field rules (best judgments)

| Field | Rule |
|-------|------|
| `id` | `^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$`; must match `country` + filename slug |
| `country` | ISO-ish lowercase: `us` \| `ca` \| `cn` (enum in schema; new countries = enum + directory, additive) |
| `network` | `visa` \| `mastercard` \| `amex` \| `discover` \| `unionpay` \| `jcb` \| `other` |
| `network_tier` | Free-form lowercase slug, documented conventions: `infinite`, `signature`, `world_elite`, `world`, `platinum`, `diamond`, `standard`, `none`, etc. **Global**, not country-specific field |
| Dual-network CN cards | Primary `network` + `network_tier`; secondary in `notes` or optional `additional_networks[]` array for dual-brand (银联 + Visa/MC/Amex) |
| `benefits[].source` | `network` \| `issuer` \| `co-brand` |
| `rewards.structure` | `single` \| `multi` \| `choice` |
| `status` | `active` \| `discontinued` \| `invite_only` \| `unknown` |
| `last_verified` | ISO date `YYYY-MM-DD`; CI may warn if older than 365 days (warn-only, not hard fail in v1) |
| `sources` | minItems 1; must be absolute http(s) URLs |
| Money | Always `{ amount, currency }` with ISO 4217; null allowed when unknown with note |
| Chinese-specific | Express lounge / fee-waiver patterns in `benefits` or `annual_fee.waiver_conditions` string — no US-only forced shape |
| Optional unknowns | Prefer `null` + `notes` over inventing numbers |

### Extensibility

- New country: add `data/{code}/`, extend `country` enum in schema (minor version), rebuild indexes.
- New benefit categories / reward shapes: prefer entries in arrays/objects; avoid breaking required field removals.
- New indexes: extend `build-indexes.ts` only; card files unchanged.

---

## 6. Seed cards (first production batch)

Minimum **6**, target **9**. All must be filled from official pages with `sources` + `last_verified`.

### Priority set

**United States**

1. Chase Sapphire Preferred (Visa Signature)  
2. American Express Gold Card  
3. Capital One Venture (or Venture X if product page is clearer)

**Canada**

4. American Express Cobalt Card  
5. Scotiabank Passport Visa Infinite  
6. TD Aeroplan Visa Infinite  

**China**

7. 招商银行经典白金卡 (or current flagship classic/Amex platinum with clear public page)  
8. One ICBC platinum / Amex co-brand representative  
9. One UnionPay high-tier (钻石 or 高阶白金) to exercise `network_tier` + bilingual fields  

### Data quality workflow

1. Open official product page + terms/benefits.  
2. Optionally consult open datasets (credit-card-bonuses-api, credit-card-db-api) as *clues only*.  
3. Fill schema fields; never copy unverified numbers.  
4. Set `sources` and `last_verified`.  
5. Prefer official image URLs.  
6. Run schema validation.  
7. Prefer one card per PR after bootstrap.

Bootstrap may commit the first batch in one or few commits to stand up the system; ongoing contributions stay one-card PRs.

---

## 7. Index artifacts & KV keys

`scripts/build-indexes.ts` reads all `data/**/*.json` and writes:

| Artifact / KV key | Content |
|-------------------|---------|
| `meta` | `{ schema_version, card_count, countries, generated_at, git_sha? }` |
| `cards:all` | Array of full card objects (sorted by `id`) |
| `cards:by-id` | Map `id → card` |
| `index:country` | Map `country → id[]` |
| `index:issuer` | Map `issuer_id → id[]` |
| `index:network` | Map `network → id[]` |
| `index:network_tier` | Map `network_tier → id[]` |

**Write strategy:** replace these keys in one deploy (≤ ~10 writes per deploy). Fits free **1,000 writes/day**.

**Size:** Entire catalog as JSON stays tiny relative to 1 GB until tens of thousands of cards. No per-card keys in v1.

Artifacts also land in `dist/indexes/` (gitignored) for CI artifacts and for users who want to download from Actions or rebuild locally. Full dataset remains browsable under `data/` on GitHub (user story 19).

---

## 8. Public API contract (`/v1`)

Base path: `/v1`. All successful responses: `Content-Type: application/json; charset=utf-8`.

### Client identification (official mode)

- Require non-empty `User-Agent` that is not a known empty/default placeholder, **or** `X-Client-Name: <app-name>`.
- Missing/invalid → **400** with JSON error:

```json
{
  "error": "client_identification_required",
  "message": "Provide a meaningful User-Agent or X-Client-Name identifying your application. Production traffic must self-host.",
  "docs": "https://github.com/<org>/opencard-db/blob/main/docs/api.md"
}
```

Self-host: `REQUIRE_CLIENT_ID=false` (default for self-host template).

### Rate limiting (official mode)

| Limit | Value |
|-------|-------|
| Per IP per minute | 30 |
| Per IP per day | 500 |

- Keyed by client IP (`CF-Connecting-IP` when present).  
- Implementation: **Cache API or in-memory counters** — **not** KV writes.  
- Exceeded → **429** with `Retry-After` (seconds) and body:

```json
{
  "error": "rate_limit_exceeded",
  "retry_after": 60,
  "message": "Rate limit exceeded on the free public instance. Self-host for production use."
}
```

Headers on limited responses: `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` when practical.

Self-host: `RATE_LIMIT_ENABLED=false` by default.

### Caching

- Successful GETs for catalog data: `Cache-Control: public, max-age=300, stale-while-revalidate=3600` (tunable via env).  
- Errors / rate limits: `Cache-Control: no-store`.  
- Optional `ETag` from `meta.generated_at` or content hash for `cards:all`.

### Endpoints

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/v1/health` | `{ ok: true, mode, generated_at? }` — no rate limit optional for probes |
| `GET` | `/v1/meta` | Meta object from KV |
| `GET` | `/v1/cards` | List cards; query filters: `country`, `issuer`, `issuer_id`, `network`, `network_tier`, `status` (AND). Pagination: `limit` (default 50, max 100), `offset` (default 0). Response: `{ total, limit, offset, data: Card[] }` |
| `GET` | `/v1/cards/{id}` | Single card or **404** `{ error: "not_found" }` |
| `GET` | `/v1/search` | Same filters as list plus optional `q` substring match on `name`, `localized_names.*`, `issuer` (case-insensitive). Same pagination envelope |
| `GET` | `/v1/indexes/{name}` | `country` \| `issuer` \| `network` \| `network_tier` → raw index map (for advanced clients) |

No write endpoints.

### Errors (uniform shape)

```json
{
  "error": "machine_code",
  "message": "Human readable explanation"
}
```

Codes: `client_identification_required`, `rate_limit_exceeded`, `not_found`, `bad_request`, `internal_error`.

### Versioning

- URL prefix `/v1/`.  
- Card `schema_version` exposed on each object and in `meta`.  
- Additive schema fields do not bump API major version.

---

## 9. Worker configuration

`worker/wrangler.toml`:

- Binding: `OPENCARD_KV` → KV namespace (placeholder id in template).  
- Vars:
  - `MODE` = `official` \| `selfhost` (default `selfhost` in template).  
  - `REQUIRE_CLIENT_ID` = `true` only when `MODE=official`.  
  - `RATE_LIMIT_ENABLED` = `true` only when `MODE=official`.  
  - `RATE_LIMIT_PER_MINUTE` = `30`  
  - `RATE_LIMIT_PER_DAY` = `500`  
  - `CACHE_MAX_AGE` = `300`  

Official instance (future): set secrets in GitHub + wrangler for account, and `MODE=official`.

---

## 10. CI / CD

### `validate.yml` (PR + push)

1. Checkout  
2. Setup Node  
3. `npm ci` (root/scripts)  
4. Run `scripts/validate.ts` — **must fail** on any schema-invalid card, duplicate id, or path/id mismatch  
5. Run `scripts/build-indexes.ts` — ensure indexes build  
6. Run unit/contract tests that do not need live Cloudflare  

### `deploy.yml` (push to `main`)

1. Same validate + build  
2. If `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `KV_NAMESPACE_ID` present:
   - Upload bulk keys to KV  
   - Optional: `wrangler deploy` for Worker  
3. Else: log “secrets not configured; skipping deploy” and **exit 0** (supports phase A)

### Local developer commands

```bash
npm run validate
npm run build:indexes
npm run test
cd worker && npm run dev   # wrangler dev with local KV mock or miniflare
```

---

## 11. Testing strategy

Test **observable behavior only** (per product testing decisions).

| Surface | What to assert |
|---------|----------------|
| Schema | Sample + all seed cards validate; invalid fixtures rejected |
| Indexes | Expected keys, ids present, counts match card files |
| API contract | Status codes, JSON shapes, filter AND semantics, pagination, 404, missing User-Agent → 400 (official mode), rate limit → 429 + Retry-After |
| Validate CLI | Exit non-zero on bad card |

Prefer contract tests against Worker with mocked KV / `wrangler dev` over unit tests of internal helpers.

CI must fail any PR that introduces schema-invalid cards.

---

## 12. Contribution model

- **Only** via GitHub Pull Requests.  
- PR template requires: official source URLs, `last_verified`, summary of changes, confirmation data was checked against issuer pages.  
- Prefer **one card per PR**.  
- No public write API.  
- Images: official URLs preferred; local mirrors need attribution and removal-on-request note in `images/README.md`.  

---

## 13. Documentation deliverables

| Doc | Audience | Content |
|-----|----------|---------|
| `README.md` | Everyone | What it is, quick start (clone data / call API), free vs self-host, license badges |
| `docs/api.md` | API consumers | Endpoints, headers, rate limits, examples, caching |
| `docs/self-hosting.md` | Operators | Create KV, set wrangler, deploy, disable rate limits, free-tier notes |
| `docs/contributing.md` | Contributors | Schema overview, one-card PR, sources, verification |
| `images/README.md` | Mirror policy | Bank copyright, removal process |

README and API docs must **discourage high-volume use of the official free instance** and point to self-hosting (user stories 8, 24).

---

## 14. Licensing & legal

- **Code** (Worker, scripts, workflows): MIT — `LICENSE`  
- **Data** (`data/**`): CC-BY-4.0 — `LICENSE-DATA` (attribution required)  
- **Images:** not relicensed; bank copyright; official URLs preferred; local mirrors removable on request  

---

## 15. Security & abuse posture

- No secrets in repo.  
- Official API: client ID + rate limits + clear self-host path.  
- No auth tokens for free API (reduces credential sprawl).  
- Card data is public product info; still treat contributor inputs as untrusted (schema validation only; no script execution from JSON).  

---

## 16. Implementation phases (for planning skill)

Recommended build order (same as product “first actions”):

1. **Schema + seed cards** (validate structure with real US/CA/CN examples)  
2. **Validation scripts + CI validate workflow**  
3. **Index builder + deploy workflow (skip if no secrets)**  
4. **Worker API + rate limit + client ID + contract tests**  
5. **Docs: README, API, self-host, CONTRIBUTING, PR template, licenses**  

Each phase leaves the repo usable: after (1)–(2) data is trustworthy; after (4) API is runnable locally; after (5) project is contribution-ready.

---

## 17. Success criteria

- Schema rejects invalid cards in CI.  
- ≥6 seed cards across US/CA/CN with official `sources` and `last_verified`.  
- Indexes build reproducibly from `data/`.  
- Worker implements documented `/v1` contract; official mode enforces client ID + free-tier rate limits.  
- Self-host path documented and works with wrangler template without rate limits.  
- Deploy workflow is safe with missing secrets (exit 0 after validate/build).  
- No paid Cloudflare features required.

---

## 18. Open items deferred (explicit non-blocking)

- Live official domain and Cloudflare account binding (post phase A).  
- Git LFS for images (only if local mirrors added).  
- Stale-data hard fail (`last_verified` age) — warn-only in v1.  
- Full-text / benefit-category search index — architecture allows adding `index:benefit_category` later without card model rewrite.  
- Countries beyond CN/US/CA.

---

## 19. Spec self-review notes

- No TBD placeholders for required v1 behavior.  
- Architecture matches free-tier constraints and pre-aggregated KV approach.  
- API, schema, CI, and contribution model are one integrated system.  
- Scope is large but intentionally single coherent deliverable; implementation plan will sequence phases without splitting into separate products.
