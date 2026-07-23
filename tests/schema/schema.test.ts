import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadAllCards, loadSchema, repoRoot } from "../../scripts/lib.ts";

const root = repoRoot();

describe("card schema contract", () => {
  it("validates all production cards", async () => {
    const schema = await loadSchema();
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const cards = await loadAllCards();
    assert.ok(cards.length >= 6, "expected at least 6 seed cards");
    for (const { file, card } of cards) {
      const ok = validate(card);
      assert.ok(
        ok,
        `${file}: ${JSON.stringify(validate.errors)}`,
      );
    }
  });

  it("rejects fixture missing sources minItems", async () => {
    const schema = await loadSchema();
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const fixturePath = path.join(
      root,
      "tests/schema/fixtures/invalid-missing-sources.json",
    );
    const card = JSON.parse(await readFile(fixturePath, "utf8"));
    assert.equal(validate(card), false);
  });

  it("ids match country-slug convention", async () => {
    const cards = await loadAllCards();
    for (const { card } of cards) {
      assert.match(card.id, /^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(card.id.startsWith(`${card.country}-`));
    }
  });
});
