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

  it("answers CORS preflight with 204 and allowed methods", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/cards", { method: "OPTIONS" }),
      { kv, MODE: "official", REQUIRE_CLIENT_ID: "true" },
    );
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(
      res.headers.get("Access-Control-Allow-Methods"),
      "GET, HEAD, OPTIONS",
    );
    assert.equal(
      res.headers.get("Access-Control-Allow-Headers"),
      "X-Client-Name",
    );
    assert.equal(res.headers.get("Access-Control-Max-Age"), "86400");
  });

  it("sets Access-Control-Allow-Origin on GET responses", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/cards?limit=1", {
        headers: { "User-Agent": "OpenCardTest/1.0" },
      }),
      { kv, MODE: "selfhost" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
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

  it("falls back to default card image when image.url is null", async () => {
    // Synthetic card on a local kv copy: no dependency on any real card
    // lacking art (cards gain images over time).
    const kv2: MemoryKv = new Map(kv);
    const byId = JSON.parse(kv2.get("cards:by-id")!);
    const donor = byId[Object.keys(byId)[0]];
    byId["zz-test-no-image"] = { ...donor, id: "zz-test-no-image", image: null };
    kv2.set("cards:by-id", JSON.stringify(byId));
    const res = await handleTestRequest(
      new Request("https://example.test/v1/cards/zz-test-no-image", {
        headers: { "X-Client-Name": "tests" },
      }),
      { kv: kv2 },
    );
    assert.equal(res.status, 200);
    const card = await res.json();
    assert.equal(
      card.image.url,
      "https://example.test/v1/assets/default-card.webp",
    );
    assert.equal(card.image.local_path, "images/default-card.webp");
  });

  it("keeps real issuer image URLs", async () => {
    const res = await handleTestRequest(
      new Request(
        "https://example.test/v1/cards/us-chase-sapphire-reserve",
        { headers: { "X-Client-Name": "tests" } },
      ),
      { kv },
    );
    assert.equal(res.status, 200);
    const card = await res.json();
    assert.match(card.image.url, /^https:\/\/creditcards\.chase\.com\//);
  });

  it("serves default card asset without client id", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/assets/default-card.webp"),
      { kv, MODE: "official", REQUIRE_CLIENT_ID: "true" },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "image/webp");
    const buf = new Uint8Array(await res.arrayBuffer());
    assert.ok(buf.byteLength > 100);
    // RIFF....WEBP
    assert.equal(String.fromCharCode(...buf.slice(0, 4)), "RIFF");
  });

  it("lists cards with default image fallback applied", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/cards?country=cn&limit=10", {
        headers: { "User-Agent": "OpenCardTest/1.0" },
      }),
      { kv },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.length >= 1);
    for (const card of body.data) {
      assert.ok(typeof card.image?.url === "string" && card.image.url.length > 0);
    }
  });

  it("meta includes default_card_image URL", async () => {
    const res = await handleTestRequest(
      new Request("https://example.test/v1/meta", {
        headers: { "User-Agent": "OpenCardTest/1.0" },
      }),
      { kv },
    );
    assert.equal(res.status, 200);
    const meta = await res.json();
    assert.equal(
      meta.default_card_image,
      "https://example.test/v1/assets/default-card.webp",
    );
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
