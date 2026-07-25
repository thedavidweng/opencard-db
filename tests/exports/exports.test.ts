import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCardsCsv,
  buildCardsYaml,
  buildExports,
  CSV_COLUMNS,
} from "../../scripts/build-exports.ts";
import { buildIndexArtifacts } from "../../scripts/build-indexes.ts";
import { loadAllCards } from "../../scripts/lib.ts";

describe("exports build contract", () => {
  it("writes all export files with the expected card count", async () => {
    const cards = await loadAllCards();
    const { files, cardCount } = await buildExports();

    assert.equal(cardCount, cards.length);
    for (const name of [
      "meta.json",
      "cards-all.json",
      "cards-by-id.json",
      "index-country.json",
      "index-issuer.json",
      "index-network.json",
      "index-network-tier.json",
      "cards.csv",
      "cards.yaml",
    ]) {
      assert.ok(files.includes(name), `missing export file: ${name}`);
    }
  });

  it("cards.csv header matches the documented columns", async () => {
    const artifacts = await buildIndexArtifacts();
    const csv = buildCardsCsv(artifacts["cards:all"]);
    const [header] = csv.split("\n");
    assert.equal(header, CSV_COLUMNS.join(","));
  });

  it("cards.csv has exactly one data row per card", async () => {
    const artifacts = await buildIndexArtifacts();
    const cards = artifacts["cards:all"];
    const csv = buildCardsCsv(cards);
    // Trailing newline → drop the final empty segment; first line is the header.
    const lines = csv.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, cards.length + 1);
  });

  it("cards.csv rows carry each card id in the first column", async () => {
    const artifacts = await buildIndexArtifacts();
    const cards = artifacts["cards:all"];
    const csv = buildCardsCsv(cards);
    const dataLines = csv.split("\n").filter((l) => l.length > 0).slice(1);
    for (let i = 0; i < cards.length; i++) {
      const firstCell = dataLines[i].split(",")[0];
      assert.equal(firstCell, cards[i].id);
    }
  });

  it("CSV-escapes fields containing commas or quotes", async () => {
    const cards = [
      {
        id: "xx-test",
        country: "xx",
        issuer_id: "test",
        network: "visa",
        network_tier: "none",
        status: "active",
        name: "Test",
        issuer: 'Bank, "The" One',
      },
    ] as unknown as Awaited<ReturnType<typeof loadAllCards>>[number]["card"][];
    const csv = buildCardsCsv(cards);
    const row = csv.split("\n")[1];
    assert.ok(
      row.includes('"Bank, ""The"" One"'),
      `expected escaped issuer, got: ${row}`,
    );
  });

  it("cards.yaml body is valid JSON (JSON-is-valid-YAML) matching cards-all", async () => {
    const artifacts = await buildIndexArtifacts();
    const cards = artifacts["cards:all"];
    const yaml = buildCardsYaml(cards);
    // Strip the leading `#` comment lines; the remainder is a JSON array.
    const body = yaml
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n")
      .trim();
    const parsed = JSON.parse(body);
    assert.equal(parsed.length, cards.length);
    assert.equal(parsed[0].id, cards[0].id);
  });
});
