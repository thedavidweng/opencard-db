import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCardsCsv,
  buildCardsYaml,
  buildExports,
  CSV_COLUMNS,
} from "../../scripts/build-exports.ts";
import {
  buildIndexArtifacts,
  deriveArtGrade,
} from "../../scripts/build-indexes.ts";
import { loadAllCards, type Card } from "../../scripts/lib.ts";

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

  it("cards.csv exposes art_grade as the final column", async () => {
    assert.equal(CSV_COLUMNS[CSV_COLUMNS.length - 1], "art_grade");
    const artifacts = await buildIndexArtifacts();
    const cards = artifacts["cards:all"];
    const csv = buildCardsCsv(cards);
    const dataLines = csv.split("\n").filter((l) => l.length > 0).slice(1);
    // art_grade is the last column and its values never need CSV escaping,
    // so the final comma-separated segment is the grade even when earlier
    // fields contain quoted commas.
    for (let i = 0; i < cards.length; i++) {
      const cell = dataLines[i].split(",").pop();
      assert.equal(cell, deriveArtGrade(cards[i]));
    }
  });

  it("derives art_grade for all three grades", () => {
    const base = {
      id: "xx-t",
      country: "xx",
      issuer_id: "t",
      network: "visa",
      network_tier: "none",
      status: "active",
      name: "T",
      issuer: "T",
    };
    const applePay = {
      ...base,
      image: {
        local_path: "images/us/xx-t.webp",
        provenance: { source: "apple-pay", source_sha256: "a".repeat(64) },
      },
    } as unknown as Card;
    const issuerLocal = {
      ...base,
      image: { local_path: "images/us/xx-t.webp" },
    } as unknown as Card;
    const issuerUrl = {
      ...base,
      image: { url: "https://issuer.example/card.png", local_path: null },
    } as unknown as Card;
    // local_path set but provenance is issuer-site → issuer, not apple-pay.
    const issuerProv = {
      ...base,
      image: {
        local_path: "images/us/xx-t.webp",
        provenance: { source: "issuer-site", source_sha256: "b".repeat(64) },
      },
    } as unknown as Card;
    const noneNull = { ...base, image: null } as unknown as Card;
    const noneEmpty = {
      ...base,
      image: { url: null, local_path: null },
    } as unknown as Card;
    const noneMissing = { ...base } as unknown as Card;

    assert.equal(deriveArtGrade(applePay), "apple-pay");
    assert.equal(deriveArtGrade(issuerLocal), "issuer");
    assert.equal(deriveArtGrade(issuerUrl), "issuer");
    assert.equal(deriveArtGrade(issuerProv), "issuer");
    assert.equal(deriveArtGrade(noneNull), "none");
    assert.equal(deriveArtGrade(noneEmpty), "none");
    assert.equal(deriveArtGrade(noneMissing), "none");
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
