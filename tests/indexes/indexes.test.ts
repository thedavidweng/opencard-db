import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ART_GRADES,
  buildIndexArtifacts,
  deriveArtGrade,
} from "../../scripts/build-indexes.ts";
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

  it("meta.art_grades counts match per-card derivation and sum to card_count", async () => {
    const artifacts = await buildIndexArtifacts();
    const counts = artifacts.meta.art_grades;

    // Exactly the three documented grade keys.
    assert.deepEqual(Object.keys(counts).sort(), [...ART_GRADES].sort());

    // Recompute independently from the artifact cards.
    const expected = { "apple-pay": 0, issuer: 0, none: 0 };
    for (const card of artifacts["cards:all"]) {
      expected[deriveArtGrade(card)] += 1;
      // The grade is also stamped onto each exported card object.
      assert.equal(card.art_grade, deriveArtGrade(card));
    }
    assert.deepEqual(counts, expected);

    const sum = ART_GRADES.reduce((acc, g) => acc + counts[g], 0);
    assert.equal(sum, artifacts.meta.card_count);
  });
});
