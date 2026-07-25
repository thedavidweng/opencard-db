import {
  DEFAULT_CARD_IMAGE_PATH,
  defaultCardImageUrl,
  withDefaultCardImage,
  withDefaultCardImages,
} from "./card-image";
import { hasClientIdentification } from "./client-id";
import {
  DEFAULT_CARD_CONTENT_TYPE,
  DEFAULT_CARD_WEBP_BASE64,
} from "./default-card-asset";
import { checkRateLimit } from "./rate-limit";
// Env comes from worker-configuration.d.ts, generated from wrangler.jsonc by
// `npm run types` (Cloudflare's recommended practice: never hand-write Env).
import type { Card, Meta } from "./types";

function defaultCardAssetResponse(): Response {
  const bytes = Uint8Array.from(atob(DEFAULT_CARD_WEBP_BASE64), (c) =>
    c.charCodeAt(0),
  );
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": DEFAULT_CARD_CONTENT_TYPE,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function errorBody(
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return { error, message, ...extra };
}

/**
 * Add CORS headers to any response so browser apps can call this public,
 * read-only API from any origin. Applied to every response on the way out
 * (including errors and the image asset). Clones headers so responses coming
 * back from the Cache API (immutable) can still be decorated.
 */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  // Only advertise ETag as readable when the response actually carries one.
  if (headers.has("ETag")) {
    headers.set("Access-Control-Expose-Headers", "ETag");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** CORS preflight: read-only API, so only GET/HEAD/OPTIONS are allowed. */
function preflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "X-Client-Name",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function intEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function getJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key, "text");
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

function matchesFilters(card: Card, url: URL): boolean {
  const country = url.searchParams.get("country");
  const issuer = url.searchParams.get("issuer");
  const issuerId = url.searchParams.get("issuer_id");
  const network = url.searchParams.get("network");
  const networkTier = url.searchParams.get("network_tier");
  const status = url.searchParams.get("status");

  if (country && card.country !== country) return false;
  if (issuer && card.issuer.toLowerCase() !== issuer.toLowerCase()) return false;
  if (issuerId && card.issuer_id !== issuerId) return false;
  if (network && card.network !== network) return false;
  if (networkTier && card.network_tier !== networkTier) return false;
  if (status && card.status !== status) return false;
  return true;
}

function searchMatch(card: Card, q: string): boolean {
  const needle = q.toLowerCase();
  if (card.name.toLowerCase().includes(needle)) return true;
  if (card.issuer.toLowerCase().includes(needle)) return true;
  if (card.id.toLowerCase().includes(needle)) return true;
  const names = card.localized_names ?? {};
  for (const v of Object.values(names)) {
    if (v.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function parsePagination(url: URL): { limit: number; offset: number } {
  let limit = Number(url.searchParams.get("limit") ?? "50");
  let offset = Number(url.searchParams.get("offset") ?? "0");
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset };
}

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  // CORS preflight is handled before method rejection and any client-id /
  // rate-limit checks so browsers can preflight the public read-only API.
  if (request.method === "OPTIONS") {
    return preflightResponse();
  }

  if (request.method !== "GET") {
    return json(errorBody("bad_request", "Only GET is supported"), 405);
  }

  const mode = env.MODE ?? "selfhost";
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/v1/health" || path === "/health") {
    return json({
      ok: true,
      mode,
      service: "opencard-db",
    });
  }

  // Public asset: usable in <img src> without client-id / rate-limit headers.
  if (path === DEFAULT_CARD_IMAGE_PATH) {
    return defaultCardAssetResponse();
  }

  if (!path.startsWith("/v1")) {
    return json(
      errorBody("not_found", "Not found. API is under /v1/."),
      404,
      { "Cache-Control": "no-store" },
    );
  }

  // Per-colo response cache. caches.default is scoped to each Cloudflare data
  // center (colo), so a hit saves a KV read + JSON.parse of the whole blob for
  // repeat requests served by the same colo. We check it BEFORE the client-id
  // gate and rate limiter on purpose: a cached hit is cheap to serve and must
  // not consume the visitor's rate-limit budget.
  const cache = caches.default;
  const cached = await cache.match(request.url);
  if (cached) return cached;

  const response = await buildCatalogResponse(request, env, url, path);
  // Cache only successful catalog responses. Errors, 404s, client-id and
  // rate-limit rejections carry Cache-Control: no-store and are never cached.
  // The Cache API honors the response's own Cache-Control max-age for expiry.
  if (response.status === 200) {
    ctx.waitUntil(cache.put(request.url, response.clone()));
  }
  return response;
}

/**
 * Builds a catalog response on a cache miss: client-id gate, rate limit and the
 * KV-backed routing for /v1/meta, /v1/cards, /v1/search and /v1/indexes.
 */
async function buildCatalogResponse(
  request: Request,
  env: Env,
  url: URL,
  path: string,
): Promise<Response> {
  const mode = env.MODE ?? "selfhost";
  const requireClientId = boolEnv(env.REQUIRE_CLIENT_ID, mode === "official");
  const rateLimitEnabled = boolEnv(env.RATE_LIMIT_ENABLED, mode === "official");
  const perMinute = intEnv(env.RATE_LIMIT_PER_MINUTE, 30);
  const perDay = intEnv(env.RATE_LIMIT_PER_DAY, 500);
  const cacheMaxAge = intEnv(env.CACHE_MAX_AGE, 300);

  if (requireClientId && !hasClientIdentification(request)) {
    return json(
      errorBody(
        "client_identification_required",
        "Provide a meaningful User-Agent or X-Client-Name identifying your application. Production traffic must self-host.",
        {
          docs: "https://github.com/thedavidweng/opencard-db/blob/main/docs/api.md",
        },
      ),
      400,
      { "Cache-Control": "no-store" },
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (rateLimitEnabled) {
    const rl = await checkRateLimit(request, perMinute, perDay);
    rateHeaders = {
      "X-RateLimit-Limit-Minute": String(perMinute),
      "X-RateLimit-Limit-Day": String(perDay),
      "X-RateLimit-Remaining-Minute": String(rl.remainingMinute),
      "X-RateLimit-Remaining-Day": String(rl.remainingDay),
    };
    if (!rl.ok) {
      return json(
        errorBody(
          "rate_limit_exceeded",
          "Rate limit exceeded on the free public instance. Self-host for production use.",
          { retry_after: rl.retryAfter },
        ),
        429,
        {
          ...rateHeaders,
          "Retry-After": String(rl.retryAfter),
          "Cache-Control": "no-store",
        },
      );
    }
  }

  const cacheHeaders = {
    ...rateHeaders,
    "Cache-Control": `public, max-age=${cacheMaxAge}, stale-while-revalidate=3600`,
  };

  const origin = url.origin;

  if (path === "/v1/meta") {
    const meta = await getJson<Meta>(env.OPENCARD_KV, "meta");
    if (!meta) {
      return json(
        errorBody("not_found", "Meta not loaded. Deploy indexes to KV."),
        404,
        { "Cache-Control": "no-store", ...rateHeaders },
      );
    }
    return json(
      { ...meta, default_card_image: defaultCardImageUrl(origin) },
      200,
      cacheHeaders,
    );
  }

  if (path === "/v1/cards") {
    const all = await getJson<Card[]>(env.OPENCARD_KV, "cards:all");
    if (!all) {
      return json(
        errorBody("not_found", "Catalog not loaded. Deploy indexes to KV."),
        404,
        { "Cache-Control": "no-store", ...rateHeaders },
      );
    }
    const filtered = all.filter((c) => matchesFilters(c, url));
    const { limit, offset } = parsePagination(url);
    const data = withDefaultCardImages(
      filtered.slice(offset, offset + limit),
      origin,
    );
    return json(
      { total: filtered.length, limit, offset, data },
      200,
      cacheHeaders,
    );
  }

  const cardMatch = path.match(/^\/v1\/cards\/([^/]+)$/);
  if (cardMatch) {
    const id = decodeURIComponent(cardMatch[1]);
    const byId = await getJson<Record<string, Card>>(
      env.OPENCARD_KV,
      "cards:by-id",
    );
    const card = byId?.[id];
    if (!card) {
      return json(errorBody("not_found", `Card not found: ${id}`), 404, {
        "Cache-Control": "no-store",
        ...rateHeaders,
      });
    }
    return json(withDefaultCardImage(card, origin), 200, cacheHeaders);
  }

  if (path === "/v1/search") {
    const all = await getJson<Card[]>(env.OPENCARD_KV, "cards:all");
    if (!all) {
      return json(
        errorBody("not_found", "Catalog not loaded. Deploy indexes to KV."),
        404,
        { "Cache-Control": "no-store", ...rateHeaders },
      );
    }
    const q = url.searchParams.get("q")?.trim() ?? "";
    let filtered = all.filter((c) => matchesFilters(c, url));
    if (q) filtered = filtered.filter((c) => searchMatch(c, q));
    const { limit, offset } = parsePagination(url);
    const data = withDefaultCardImages(
      filtered.slice(offset, offset + limit),
      origin,
    );
    return json(
      { total: filtered.length, limit, offset, data, q: q || null },
      200,
      cacheHeaders,
    );
  }

  const indexMatch = path.match(/^\/v1\/indexes\/([^/]+)$/);
  if (indexMatch) {
    const name = indexMatch[1];
    const keyMap: Record<string, string> = {
      country: "index:country",
      issuer: "index:issuer",
      network: "index:network",
      network_tier: "index:network_tier",
    };
    const key = keyMap[name];
    if (!key) {
      return json(
        errorBody(
          "bad_request",
          "Unknown index. Use country|issuer|network|network_tier.",
        ),
        400,
        { "Cache-Control": "no-store", ...rateHeaders },
      );
    }
    const index = await getJson<Record<string, string[]>>(env.OPENCARD_KV, key);
    if (!index) {
      return json(errorBody("not_found", "Index not loaded."), 404, {
        "Cache-Control": "no-store",
        ...rateHeaders,
      });
    }
    return json(index, 200, cacheHeaders);
  }

  return json(errorBody("not_found", "Not found"), 404, {
    "Cache-Control": "no-store",
    ...rateHeaders,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      // CORS is applied to every egress response (success, error and asset).
      return withCors(await handleRequest(request, env, ctx));
    } catch (err) {
      console.error(err);
      return withCors(
        json(errorBody("internal_error", "Internal server error"), 500, {
          "Cache-Control": "no-store",
        }),
      );
    }
  },
};

/** Test helper: run handler without Workers runtime */
export { handleRequest, hasClientIdentification };
