# Serve the catalog from few pre-aggregated KV keys

The Worker reads Card data from a small set of Cloudflare KV keys produced at deploy time: `meta`, `cards:all`, `cards:by-id`, and indexes by country, issuer, network, and network_tier. List/search filters run in the Worker over these payloads. We do not store one KV key per Card and do not use KV list operations as the primary query path.

**Status:** accepted

**Why:** Cloudflare Free allows only ~1,000 KV writes/day and 100k reads/day. Bulk keys keep deploys within write budget and typical requests within one read. Catalog size stays small enough for in-memory filter for the foreseeable future.

**Considered options:** per-Card keys; git/static-only serving without KV. Rejected for free-tier write cost and weaker official API control respectively.
