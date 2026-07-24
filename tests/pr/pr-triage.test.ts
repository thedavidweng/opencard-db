import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectRegions,
  parseTitle,
  suggestTitle,
  triagePullRequest,
} from "../../scripts/pr-triage.ts";

const goodBody = `
## What kind of change is this?

- [x] **New card** (add a file under \`data/us/\`, \`data/ca/\`, or \`data/cn/\`)
- [ ] **Update existing card**
- [ ] **Not a card**

### 1. Identity

- **Card ID:** \`us-chase-sapphire-preferred\`
- **Country:** \`us\`
- **File path:** \`data/us/chase-sapphire-preferred.json\`
- **Display name:** Chase Sapphire Preferred

### 2. Official sources (required)

- **Product page:** https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred
- **Terms / benefits page:** https://www.chase.com/personal/credit-cards/sapphire/preferred
- **Last verified (YYYY-MM-DD):** 2026-07-24

### 3. Card image (pick one)

- [x] **A. Official image URL** (preferred)
  - **Image URL:** https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_preferred_card.png
- [ ] **B. Upload a local file in this PR**
- [ ] **C. No image yet**
`;

describe("pr triage", () => {
  it("parses card and meta titles", () => {
    assert.equal(parseTitle("Add card: us-amex-gold").ok, true);
    assert.equal(parseTitle("Update card: ca-amex-cobalt").kind, "update-card");
    assert.equal(parseTitle("docs: fix contributing").ok, true);
    assert.equal(parseTitle("Add a new sapphire card").ok, false);
  });

  it("detects regions from paths", () => {
    assert.deepEqual(
      detectRegions(["data/us/a.json", "data/cn/b.json", "README.md"]),
      ["US", "CN"],
    );
  });

  it("suggests title from body card id", () => {
    assert.equal(
      suggestTitle(["data/us/chase-sapphire-preferred.json"], goodBody),
      "Add card: us-chase-sapphire-preferred",
    );
  });

  it("passes a complete card PR", () => {
    const r = triagePullRequest({
      title: "Add card: us-chase-sapphire-preferred",
      body: goodBody,
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
    });
    assert.equal(r.titleOk, true);
    assert.deepEqual(r.regions, ["US"]);
    assert.equal(r.missing.length, 0);
    assert.ok(r.labelsAdd.includes("US"));
    assert.ok(r.labelsAdd.includes("new-card"));
    assert.ok(!r.labelsAdd.includes("needs-info"));
  });

  it("flags placeholder sources and bad title", () => {
    const r = triagePullRequest({
      title: "my card pr",
      body: goodBody
        .replace("us-chase-sapphire-preferred", "us-example-card")
        .replace(
          "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
          "https://www.example-bank.com/cards/example",
        )
        .replace(
          "https://www.chase.com/personal/credit-cards/sapphire/preferred",
          "https://www.example-bank.com/cards/example/terms",
        )
        .replace(
          "https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_preferred_card.png",
          "https://www.example-bank.com/cardart/example.png",
        ),
      changedFiles: ["data/us/example-card.json"],
    });
    assert.equal(r.titleOk, false);
    assert.ok(r.missing.some((m) => m.includes("Card ID")));
    assert.ok(r.missing.some((m) => m.toLowerCase().includes("source")));
    assert.ok(r.labelsAdd.includes("needs-info"));
    assert.ok(r.labelsAdd.includes("title-needs-fix"));
  });

  it("accepts no-image checkbox", () => {
    const body = goodBody
      .replace("- [x] **A. Official image URL**", "- [ ] **A. Official image URL**")
      .replace(
        "- **Image URL:** https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_preferred_card.png",
        "- **Image URL:** ",
      )
      .replace("- [ ] **C. No image yet**", "- [x] **C. No image yet**");
    const r = triagePullRequest({
      title: "Add card: us-chase-sapphire-preferred",
      body,
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
    });
    assert.equal(r.missing.length, 0);
  });
});
