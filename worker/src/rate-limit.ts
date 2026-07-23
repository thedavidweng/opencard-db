/**
 * Rate limiting via Cache API (not KV writes) so free-tier write budget is preserved.
 * Best-effort per isolate/edge; sufficient for free official instance abuse throttling.
 */

export type RateLimitResult =
  | { ok: true; remainingMinute: number; remainingDay: number }
  | { ok: false; retryAfter: number; remainingMinute: number; remainingDay: number };

function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function getCount(cache: Cache, key: string): Promise<number> {
  const res = await cache.match(key);
  if (!res) return 0;
  const n = Number(await res.text());
  return Number.isFinite(n) ? n : 0;
}

async function setCount(
  cache: Cache,
  key: string,
  count: number,
  ttlSeconds: number,
): Promise<void> {
  await cache.put(
    key,
    new Response(String(count), {
      headers: {
        "Cache-Control": `max-age=${ttlSeconds}`,
        "Content-Type": "text/plain",
      },
    }),
  );
}

export async function checkRateLimit(
  request: Request,
  perMinute: number,
  perDay: number,
): Promise<RateLimitResult> {
  const ip = encodeURIComponent(clientIp(request));
  const cache = caches.default;
  const now = Math.floor(Date.now() / 1000);
  const minuteBucket = Math.floor(now / 60);
  const dayBucket = Math.floor(now / 86400);

  const minuteKey = `https://opencard-db.rate/m/${ip}/${minuteBucket}`;
  const dayKey = `https://opencard-db.rate/d/${ip}/${dayBucket}`;

  const [minuteCount, dayCount] = await Promise.all([
    getCount(cache, minuteKey),
    getCount(cache, dayKey),
  ]);

  if (minuteCount >= perMinute) {
    return {
      ok: false,
      retryAfter: 60 - (now % 60) || 60,
      remainingMinute: 0,
      remainingDay: Math.max(0, perDay - dayCount),
    };
  }
  if (dayCount >= perDay) {
    return {
      ok: false,
      retryAfter: 86400 - (now % 86400) || 86400,
      remainingMinute: Math.max(0, perMinute - minuteCount),
      remainingDay: 0,
    };
  }

  await Promise.all([
    setCount(cache, minuteKey, minuteCount + 1, 120),
    setCount(cache, dayKey, dayCount + 1, 90000),
  ]);

  return {
    ok: true,
    remainingMinute: Math.max(0, perMinute - minuteCount - 1),
    remainingDay: Math.max(0, perDay - dayCount - 1),
  };
}
