# OpenCard DB API

Base path: `/v1`. All responses are JSON (`Content-Type: application/json; charset=utf-8`).

Machine-readable spec: [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.0).

## Which path should I use?

The `/v1` API is one of three ways to consume the catalog:

- **(a) Production (recommended):** jsDelivr tag-pinned, immutable, zero-quota
  static files — `https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@v0.1.0/exports/cards-all.json`.
- **(b) Preview / dev:** `@main` jsDelivr or `raw.githubusercontent.com` (mutable, ~12h stale on jsDelivr).
- **(c) This `/v1` API:** filtering, search, and per-card lookup. **Self-host for
  production**; the official instance is **best-effort** and rate-limited.

See the repo [README](../README.md#get-the-data) for the full tier breakdown.

## Official free instance vs self-host

| Mode | Client ID | Rate limits |
|------|-----------|-------------|
| **Official** (`MODE=official`) | Required: meaningful `User-Agent` **or** `X-Client-Name` | 30 req/min and 500 req/day per IP |
| **Self-host** (template default) | Optional | Off (use your own Cloudflare Free quotas) |

High-volume or production traffic **must self-host**. See [self-hosting.md](./self-hosting.md).

## Client identification (official)

```http
User-Agent: MyApp/1.0 (+https://example.com)
# or
X-Client-Name: MyApp
```

Missing/empty → **400**

```json
{
  "error": "client_identification_required",
  "message": "…",
  "docs": "https://github.com/thedavidweng/opencard-db/blob/main/docs/api.md"
}
```

## Rate limits (official)

- **429** with `Retry-After` (seconds)
- Body: `{ "error": "rate_limit_exceeded", "retry_after": 60, "message": "…" }`

## Caching

Successful catalog GETs include:

```http
Cache-Control: public, max-age=300, stale-while-revalidate=3600
```

Errors and rate limits use `Cache-Control: no-store`.

Responses are additionally cached per-colo in the Worker (Cloudflare Cache API)
to cut KV reads on repeat requests. See [self-hosting.md](./self-hosting.md#caching-and-the-free-tier).

## CORS

The API is public and read-only, so **any origin** may call it from the browser:

- Every response includes `Access-Control-Allow-Origin: *`.
- Only `GET`, `HEAD`, and `OPTIONS` are supported (other methods → **405**).
- Preflight `OPTIONS` returns **204** with
  `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`,
  `Access-Control-Allow-Headers: X-Client-Name`, and `Access-Control-Max-Age: 86400`.
- `ETag` is advertised via `Access-Control-Expose-Headers` when present.

## Endpoints

### `GET /v1/health`

Liveness. No client-id requirement.

```json
{ "ok": true, "mode": "selfhost", "service": "opencard-db" }
```

### `GET /v1/meta`

Catalog metadata (`schema_version`, `card_count`, `countries`, `generated_at`).

Also includes `art_grades`: card-art grade counts, e.g.
`{ "apple-pay": 0, "issuer": 162, "none": 27 }` — mirroring the `art_grade`
field on each card (see below). The same object appears in
[`exports/meta.json`](../exports/meta.json).

Also includes `default_card_image`: absolute URL of the generic card-face placeholder used when a card has no image.

### `GET /v1/assets/default-card.webp`

Generic OpenCard placeholder card face (WebP). **No client-id or rate-limit required** so it can be used directly in `<img src>`.

### Card images

`image` is optional in source JSON (`null`, or `{ "url": null, ... }`).

API list/get/search responses always enrich missing `image.url` to the absolute default asset:

```json
{
  "image": {
    "url": "https://<host>/v1/assets/default-card.webp",
    "attribution": "OpenCard DB generic placeholder (not bank artwork)",
    "local_path": "images/default-card.webp"
  }
}
```

If the card already has a non-empty `image.url` (official issuer URL), it is left unchanged.

### Card art grade

Every card object — in the static `exports/` (`cards-all.json`, `cards-by-id.json`,
and the `art_grade` column of `cards.csv`) and in API card responses — carries a
derived `art_grade` string, computed at build time and never stored in `data/`:

- `"apple-pay"` — graduated art: a committed local face with `apple-pay`
  provenance and SHA lineage.
- `"issuer"` — official issuer-site artwork (local face or `image.url`) without
  Apple Pay provenance.
- `"none"` — no card face.

Catalog-wide counts are in `meta.art_grades`.

### `GET /v1/cards`

List Cards. Query params (AND):

| Param | Description |
|-------|-------------|
| `country` | `us` \| `ca` \| `cn` |
| `issuer` | Display name (case-insensitive) |
| `issuer_id` | Stable issuer slug |
| `network` | e.g. `visa`, `amex` |
| `network_tier` | e.g. `infinite`, `none` |
| `status` | e.g. `active` |
| `limit` | Default 50, max 100 |
| `offset` | Default 0 |

```json
{ "total": 9, "limit": 50, "offset": 0, "data": [ /* Card objects */ ] }
```

### `GET /v1/cards/{id}`

Single Card by Card Id (e.g. `us-chase-sapphire-preferred`). **404** if missing.

### `GET /v1/search`

Same filters as list, plus optional `q` substring match on `name`, `localized_names`, `issuer`, and `id`.

### `GET /v1/indexes/{name}`

Raw id lists: `country` | `issuer` | `network` | `network_tier`.

## Error shape

```json
{ "error": "machine_code", "message": "Human readable explanation" }
```

Codes: `client_identification_required`, `rate_limit_exceeded`, `not_found`, `bad_request`, `internal_error`.

## Offline alternative

Clone the repo and read `data/{country}/*.json` directly (CC BY 4.0 attribution).
