import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { buildIndexArtifacts } from "../../scripts/build-indexes.ts";
import {
  handleTestRequest,
  resetTestRateLimits,
  type MemoryKv,
} from "../../scripts/export-handler.ts";

async function buildKv(): Promise<MemoryKv> {
  const a = await buildIndexArtifacts();
  const kv: MemoryKv = new Map();
  kv.set("meta", JSON.stringify(a.meta));
  kv.set("cards:all", JSON.stringify(a["cards:all"]));
  kv.set("cards:by-id", JSON.stringify(a["cards:by-id"]));
  kv.set("index:country", JSON.stringify(a["index:country"]));
  kv.set("index:issuer", JSON.stringify(a["index:issuer"]));
  kv.set("index:network", JSON.stringify(a["index:network"]));
  kv.set("index:network_tier", JSON.stringify(a["index:network_tier"]));
  return kv;
}

describe("API contract /v1", () => {
  let kv: MemoryKv;

  before(async () => {
    kv = await buildKv();
  });

  it("health is ok without client id", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/health"),
      { kv, MODE: "official", REQUIRE_CLIENT_ID: "true" },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it("official mode requires client identification", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/cards"),
      { kv, MODE: "official", REQUIRE_CLIENT_ID: "true" },
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "client_identification_required");
  });

  it("lists cards with filter and pagination", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/cards?country=us&limit=2", {
        headers: { "User-Agent": "OpenCardTest/1.0" },
      }),
      { kv, MODE: "selfhost" },
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Cache-Control") ?? "", /max-age=/);
    const body = await res.json();
    assert.ok(body.total >= 1);
    assert.equal(body.limit, 2);
    assert.ok(body.data.every((c: { country: string }) => c.country === "us"));
  });

  it("gets card by id and 404s missing", async () => {
    const ok = await handleTestRequest(
      new Request(
        "https://example.test/v1/cards/us-chase-sapphire-preferred",
        { headers: { "X-Client-Name": "tests" } },
      ),
      { kv },
    );
    assert.equal(ok.status, 200);
    const card = await ok.json();
    assert.equal(card.id, "us-chase-sapphire-preferred");
    assert.equal(card.network_tier, "signature");

    const missing = await handleTestRequest(
      new Request("https://example.test/v1/cards/no-such-card", {
        headers: { "X-Client-Name": "tests" },
      }),
      { kv },
    );
    assert.equal(missing.status, 404);
  });

  it("search by q", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/search?q=cobalt", {
        headers: { "User-Agent": "OpenCardTest/1.0" },
      }),
      { kv },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.total >= 1);
    assert.ok(
      body.data.some((c: { id: string }) => c.id.includes("cobalt")),
    );
  });

  it("returns 429 when rate limited", async () => {
    resetTestRateLimits();
    const env = {
      kv,
      MODE: "official",
      REQUIRE_CLIENT_ID: "true",
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_PER_MINUTE: "2",
      RATE_LIMIT_PER_DAY: "100",
    };
    const headers = {
      "User-Agent": "OpenCardTest/1.0",
      "CF-Connecting-IP": "203.0.113.9",
    };
    assert.equal(
      (
        await handleTestRequest(
          new Request("https://example.test/v1/meta", { headers }),
          env,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await handleTestRequest(
          new Request("https://example.test/v1/meta", { headers }),
          env,
        )
      ).status,
      200,
    );
    const limited = await handleTestRequest(
      new Request("https://example.test/v1/meta", { headers }),
      env,
    );
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("Retry-After"));
    const body = await limited.json();
    assert.equal(body.error, "rate_limit_exceeded");
  });
});
