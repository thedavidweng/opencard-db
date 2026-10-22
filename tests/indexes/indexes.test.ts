import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ART_GRADES,
  buildIndexArtifacts,
  DEFAULT_IMAGE_BASE_URL,
  deriveArtGrade,
  withRepoImageUrl,
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

  it("derives image.url for repo-hosted art (local_path only), keeps explicit urls", async () => {
    const sources = new Map(
      (await loadAllCards()).map(({ card }) => [card.id, card]),
    );
    const artifacts = await buildIndexArtifacts();
    let derived = 0;
    for (const card of artifacts["cards:all"]) {
      const src = sources.get(card.id)?.image as
        | { url?: string | null; local_path?: string | null }
        | null
        | undefined;
      const out = card.image as { url?: string | null } | null | undefined;
      if (src?.url) {
        assert.equal(out?.url, src.url, `${card.id}: explicit url unchanged`);
      } else if (src?.local_path) {
        derived += 1;
        assert.equal(
          out?.url,
          `${DEFAULT_IMAGE_BASE_URL}/${src.local_path}`,
          `${card.id}: url derived from local_path`,
        );
      } else {
        assert.ok(!out?.url, `${card.id}: no art stays without url`);
      }
    }
    assert.ok(derived > 0, "at least one repo-hosted image is derived");
  });

  it("withRepoImageUrl handles edge cases", () => {
    const base = "https://cdn.example/x@main/";
    const mk = (image: unknown) => ({ id: "t", image }) as never;
    assert.equal(
      (withRepoImageUrl(mk({ url: null, local_path: "./images/a b.webp" }), base.replace(/\/$/, "")) as { image: { url: string } }).image.url,
      "https://cdn.example/x@main/images/a%20b.webp",
    );
    assert.equal(
      (withRepoImageUrl(mk({ url: "https://issuer/a.png", local_path: "images/a.webp" })) as { image: { url: string } }).image.url,
      "https://issuer/a.png",
    );
    assert.equal((withRepoImageUrl(mk(null)) as { image: unknown }).image, null);
    assert.equal(
      (withRepoImageUrl(mk({ url: null, local_path: null })) as { image: { url: unknown } }).image.url,
      null,
    );
  });
});
