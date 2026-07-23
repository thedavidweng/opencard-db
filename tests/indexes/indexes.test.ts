import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIndexArtifacts } from "../../scripts/build-indexes.ts";
import { loadAllCards } from "../../scripts/lib.ts";

describe("index build contract", () => {
  it("produces expected keys and matching counts", async () => {
    const cards = await loadAllCards();
    const artifacts = await buildIndexArtifacts();

    assert.equal(artifacts.meta.card_count, cards.length);
    assert.equal(artifacts["cards:all"].length, cards.length);
    assert.equal(Object.keys(artifacts["cards:by-id"]).length, cards.length);

    for (const { card } of cards) {
      assert.equal(artifacts["cards:by-id"][card.id]?.id, card.id);
      assert.ok(artifacts["index:country"][card.country]?.includes(card.id));
      assert.ok(artifacts["index:issuer"][card.issuer_id]?.includes(card.id));
      assert.ok(artifacts["index:network"][card.network]?.includes(card.id));
      assert.ok(
        artifacts["index:network_tier"][card.network_tier]?.includes(card.id),
      );
    }

    assert.ok(artifacts.meta.countries.includes("us"));
    assert.ok(artifacts.meta.countries.includes("ca"));
    assert.ok(artifacts.meta.countries.includes("cn"));
  });
});
