/**
 * Re-export pure request handling for Node contract tests without wrangler.
 * Mirrors worker routing logic against an in-memory KV map.
 */
import {
  DEFAULT_CARD_IMAGE_PATH,
  defaultCardImageUrl,
  withDefaultCardImage,
  withDefaultCardImages,
} from "../worker/src/card-image.ts";
import { hasClientIdentification } from "../worker/src/client-id.ts";
import {
  DEFAULT_CARD_CONTENT_TYPE,
  DEFAULT_CARD_WEBP_BASE64,
} from "../worker/src/default-card-asset.ts";

export type MemoryKv = Map<string, string>;

export type TestEnv = {
  kv: MemoryKv;
  MODE?: string;
  REQUIRE_CLIENT_ID?: string;
  RATE_LIMIT_ENABLED?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  RATE_LIMIT_PER_DAY?: string;
  CACHE_MAX_AGE?: string;
};

type Card = {
  id: string;
  name: string;
  country: string;
  issuer: string;
  issuer_id: string;
  network: string;
  network_tier: string;
  status: string;
  localized_names?: Record<string, string>;
  image?: {
    url: string | null;
    attribution?: string | null;
    local_path?: string | null;
  } | null;
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

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

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function intEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
  for (const v of Object.values(card.localized_names ?? {})) {
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

/** In-memory rate limit for tests only */
const testBuckets = new Map<string, number>();

function testRateLimit(
  ip: string,
  perMinute: number,
  perDay: number,
): { ok: boolean; retryAfter: number } {
  const now = Math.floor(Date.now() / 1000);
  const mk = `m:${ip}:${Math.floor(now / 60)}`;
  const dk = `d:${ip}:${Math.floor(now / 86400)}`;
  const mc = testBuckets.get(mk) ?? 0;
  const dc = testBuckets.get(dk) ?? 0;
  if (mc >= perMinute) return { ok: false, retryAfter: 60 };
  if (dc >= perDay) return { ok: false, retryAfter: 3600 };
  testBuckets.set(mk, mc + 1);
  testBuckets.set(dk, dc + 1);
  return { ok: true, retryAfter: 0 };
}

export function resetTestRateLimits(): void {
  testBuckets.clear();
}

export async function handleTestRequest(
  request: Request,
  env: TestEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const mode = env.MODE ?? "selfhost";
  const requireClientId = boolEnv(env.REQUIRE_CLIENT_ID, mode === "official");
  const rateLimitEnabled = boolEnv(env.RATE_LIMIT_ENABLED, mode === "official");
  const perMinute = intEnv(env.RATE_LIMIT_PER_MINUTE, 30);
  const perDay = intEnv(env.RATE_LIMIT_PER_DAY, 500);
  const cacheMaxAge = intEnv(env.CACHE_MAX_AGE, 300);

  if (path === "/v1/health") {
    return json({ ok: true, mode, service: "opencard-db" });
  }

  if (path === DEFAULT_CARD_IMAGE_PATH) {
    return defaultCardAssetResponse();
  }

  if (requireClientId && !hasClientIdentification(request)) {
    return json(
      {
        error: "client_identification_required",
        message:
          "Provide a meaningful User-Agent or X-Client-Name identifying your application.",
      },
      400,
      { "Cache-Control": "no-store" },
    );
  }

  if (rateLimitEnabled) {
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "test";
    const rl = testRateLimit(ip, perMinute, perDay);
    if (!rl.ok) {
      return json(
        {
          error: "rate_limit_exceeded",
          retry_after: rl.retryAfter,
          message: "Rate limit exceeded",
        },
        429,
        {
          "Retry-After": String(rl.retryAfter),
          "Cache-Control": "no-store",
        },
      );
    }
  }

  const cacheHeaders = {
    "Cache-Control": `public, max-age=${cacheMaxAge}, stale-while-revalidate=3600`,
  };

  const get = <T,>(key: string): T | null => {
    const raw = env.kv.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  };

  const origin = url.origin;

  if (path === "/v1/meta") {
    const meta = get<Record<string, unknown>>("meta");
    if (!meta) return json({ error: "not_found" }, 404);
    return json(
      { ...meta, default_card_image: defaultCardImageUrl(origin) },
      200,
      cacheHeaders,
    );
  }

  if (path === "/v1/cards") {
    const all = get<Card[]>("cards:all") ?? [];
    const filtered = all.filter((c) => matchesFilters(c, url));
    const { limit, offset } = parsePagination(url);
    return json(
      {
        total: filtered.length,
        limit,
        offset,
        data: withDefaultCardImages(
          filtered.slice(offset, offset + limit),
          origin,
        ),
      },
      200,
      cacheHeaders,
    );
  }

  const cardMatch = path.match(/^\/v1\/cards\/([^/]+)$/);
  if (cardMatch) {
    const byId = get<Record<string, Card>>("cards:by-id") ?? {};
    const card = byId[decodeURIComponent(cardMatch[1])];
    if (!card) return json({ error: "not_found" }, 404);
    return json(withDefaultCardImage(card, origin), 200, cacheHeaders);
  }

  if (path === "/v1/search") {
    const all = get<Card[]>("cards:all") ?? [];
    const q = url.searchParams.get("q")?.trim() ?? "";
    let filtered = all.filter((c) => matchesFilters(c, url));
    if (q) filtered = filtered.filter((c) => searchMatch(c, q));
    const { limit, offset } = parsePagination(url);
    return json(
      {
        total: filtered.length,
        limit,
        offset,
        data: withDefaultCardImages(
          filtered.slice(offset, offset + limit),
          origin,
        ),
        q: q || null,
      },
      200,
      cacheHeaders,
    );
  }

  return json({ error: "not_found" }, 404);
}

export { hasClientIdentification };
