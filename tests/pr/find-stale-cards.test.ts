import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_STALE_DAYS,
  daysSince,
  findStaleCards,
} from "../../scripts/find-stale-cards.ts";
import type { Card } from "../../scripts/lib.ts";

function card(id: string, lastVerified: unknown): Card {
  return {
    id,
    country: id.slice(0, 2),
    issuer_id: "issuer",
    network: "visa",
    network_tier: "none",
    status: "active",
    name: id,
    last_verified: lastVerified,
  } as Card;
}

const TODAY = new Date("2026-07-24T12:00:00Z");

describe("find stale cards", () => {
  it("counts whole UTC days between last_verified and today", () => {
    assert.equal(daysSince("2026-07-24", TODAY), 0);
    assert.equal(daysSince("2026-07-23", TODAY), 1);
    assert.equal(daysSince("2026-01-25", TODAY), 180);
    assert.equal(daysSince("2026-01-24", TODAY), 181);
  });

  it("returns NaN for missing or malformed dates", () => {
    assert.ok(Number.isNaN(daysSince("", TODAY)));
    assert.ok(Number.isNaN(daysSince("not-a-date", TODAY)));
    assert.ok(Number.isNaN(daysSince("2026-7-4", TODAY)));
  });

  it("flags only cards strictly older than the threshold", () => {
    const cards = [
      { file: "data/us/fresh.json", card: card("us-fresh", "2026-07-01") },
      { file: "data/us/edge.json", card: card("us-edge", "2026-01-25") }, // exactly 180 → not stale
      { file: "data/us/stale.json", card: card("us-stale", "2026-01-24") }, // 181 → stale
      { file: "data/ca/old.json", card: card("ca-old", "2025-01-01") },
    ];
    const stale = findStaleCards(cards, 180, TODAY);
    assert.deepEqual(
      stale.map((s) => s.id),
      ["ca-old", "us-stale"],
    );
    assert.equal(stale[0].file, "data/ca/old.json");
    assert.equal(stale[1].days, 181);
  });

  it("sorts most-stale first, then by id", () => {
    const cards = [
      { file: "b.json", card: card("us-b", "2025-06-01") },
      { file: "a.json", card: card("us-a", "2025-06-01") },
      { file: "c.json", card: card("us-c", "2024-01-01") },
    ];
    const stale = findStaleCards(cards, 30, TODAY);
    assert.deepEqual(
      stale.map((s) => s.id),
      ["us-c", "us-a", "us-b"],
    );
  });

  it("skips cards with a missing or non-string last_verified", () => {
    const cards = [
      { file: "n.json", card: card("us-null", null) },
      { file: "u.json", card: card("us-undef", undefined) },
      { file: "b.json", card: card("us-bad", "nope") },
      { file: "ok.json", card: card("us-ok", "2000-01-01") },
    ];
    const stale = findStaleCards(cards, 180, TODAY);
    assert.deepEqual(
      stale.map((s) => s.id),
      ["us-ok"],
    );
  });

  it("uses a 180-day default window", () => {
    assert.equal(DEFAULT_STALE_DAYS, 180);
  });
});
