import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "../../scripts/lib.ts";
import {
  COUNTRY_RE,
  SLUG_RE,
  cardRelPath,
  parseFlags,
  scaffoldFromTemplate,
  slugify,
} from "../../scripts/new-card.ts";

describe("new:card scaffold helpers", () => {
  it("slugifies names to the id charset", () => {
    assert.equal(slugify("My Card"), "my-card");
    assert.equal(slugify("Chase Sapphire Preferred®"), "chase-sapphire-preferred");
    assert.equal(slugify("  Amex  Gold!!  "), "amex-gold");
    assert.equal(slugify("A_B/C"), "a-b-c");
  });

  it("produced slugs and countries satisfy the id-pattern parts", () => {
    for (const name of ["My Card", "Chase Sapphire Preferred®", "US Bank Shield"]) {
      assert.match(slugify(name), SLUG_RE);
    }
    assert.match("us", COUNTRY_RE);
    assert.doesNotMatch("USA", COUNTRY_RE);
    assert.doesNotMatch("Us", COUNTRY_RE);
  });

  it("builds a repo-relative card path", () => {
    assert.equal(cardRelPath("us", "my-card"), "data/us/my-card.json");
    assert.equal(cardRelPath("cn", "cmb-classic"), "data/cn/cmb-classic.json");
  });

  it("parses flags in space and = forms", () => {
    assert.deepEqual(
      parseFlags(["--country", "us", "--slug", "my-card", "--name", "My Card"]),
      { country: "us", slug: "my-card", name: "My Card" },
    );
    assert.deepEqual(parseFlags(["--country=ca", "--slug=x"]), {
      country: "ca",
      slug: "x",
    });
    assert.equal(parseFlags(["--help"]).help, true);
  });

  it("scaffolds from the real template setting only identity fields", async () => {
    const template = JSON.parse(
      await readFile(
        path.join(repoRoot(), "templates/card.template.json"),
        "utf8",
      ),
    );
    const card = scaffoldFromTemplate(template, {
      country: "us",
      slug: "my-card",
      name: "My Card",
      today: "2026-07-24",
    });
    assert.equal(card.id, "us-my-card");
    assert.equal(card.country, "us");
    assert.equal(card.name, "My Card");
    assert.equal((card.localized_names as { en: string }).en, "My Card");
    assert.equal(card.last_verified, "2026-07-24");
    // Untouched template fields stay put; the template is not mutated.
    assert.equal(card.schema_version, "1.0.0");
    assert.equal(template.id, "us-example-card");
  });
});
