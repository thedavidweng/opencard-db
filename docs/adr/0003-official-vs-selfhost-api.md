# Same Worker, two modes: rate-limited official free API and unlimited self-host

One Worker codebase serves both the project’s optional official free instance and self-hosted deployments. Official mode requires a meaningful client identifier (`User-Agent` or `X-Client-Name`), enforces 30 requests/minute and 500 requests/day per IP, returns 429 + `Retry-After`, and sets cache-friendly headers on GETs. Self-host template defaults leave client-id and rate limits off so operators use their own Cloudflare Free quotas. Rate-limit state must not be stored via KV writes (use Cache API or in-memory). Production and high-volume use must self-host; the free official instance is for prototyping.

**Status:** accepted

**Constraints:** Cloudflare Free only ($0) — ~100k Worker requests/day and ~100k KV reads/day. No paid Workers/KV features.

**Considered options:** official-only hosting; self-host-only with no official API design. Rejected as either unsustainable for maintainers or weaker for developers who need a zero-setup playground.
