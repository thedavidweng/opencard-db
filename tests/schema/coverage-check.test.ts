import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCovered, normIssuer, normName } from "../../scripts/coverage-check.ts";
import type { LocalCard } from "../../scripts/coverage-check.ts";

function local(id: string, name: string, issuerId: string): LocalCard {
  return {
    id,
    nameTokens: new Set(normName(name).split(" ").filter(Boolean)),
    issuerId,
  };
}

const LOCALS: LocalCard[] = [
  local("us-amex-gold", "American Express® Gold Card", "amex"),
  local("us-amex-lowes", "Lowe's Business Rewards Card from American Express", "amex"),
  local("us-bank-of-america-premium-rewards", "Premium Rewards Credit Card", "bank-of-america"),
  local("us-chase-world-of-hyatt", "World of Hyatt Credit Card", "chase"),
];

describe("coverage check matching", () => {
  it("normalizes names (stopwords, apostrophes, symbols)", () => {
    assert.equal(normName("The Lowe's Business Rewards Card"), "lowes business rewards");
    assert.equal(normName("Premium Rewards®"), "premium rewards");
  });

  it("normalizes issuers (aliases, underscores, dots)", () => {
    assert.equal(normIssuer("AMERICAN_EXPRESS"), "amex");
    assert.equal(normIssuer("BANK_OF_AMERICA"), "bank-of-america");
    assert.equal(normIssuer("U.S. Bank"), "us-bank");
  });

  it("covers terse upstream names via containment + issuer agreement", () => {
    assert.equal(isCovered("Gold", "AMERICAN_EXPRESS", LOCALS).covered, true);
    assert.equal(isCovered("Lowes", "AMERICAN_EXPRESS", LOCALS).covered, true);
    assert.equal(
      isCovered("Premium Rewards", "BANK_OF_AMERICA", LOCALS).covered,
      true,
    );
  });

  it("does not cover genuinely missing variants", () => {
    const r = isCovered("World of Hyatt Business", "CHASE", LOCALS);
    assert.equal(r.covered, false);
    assert.equal(r.nearest, "us-chase-world-of-hyatt");
  });

  it("issuer mismatch alone does not fake coverage", () => {
    assert.equal(isCovered("Gold", "PENFED", LOCALS).covered, false);
  });
});
