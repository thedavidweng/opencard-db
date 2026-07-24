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

### 3. Card image (pick the best you can)

- [x] **A. Official issuer image URL** (stable product-page art)
  - **Image URL:** https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_preferred_card.png
- [ ] **B. Apple Pay extract (preferred local mirror — “graduation-level”)**
- [ ] **C. Other local upload**
- [ ] **D. No image yet**
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
    assert.ok(r.classificationLabelsAdd.includes("US"));
    assert.ok(r.classificationLabelsAdd.includes("new-card"));
    assert.ok(!r.completenessLabelsAdd.includes("needs-info"));
    assert.ok(!r.classificationLabelsAdd.includes("enhancement"));
    assert.ok(r.classificationLabelsRemove.includes("enhancement"));
  });

  it("labels feature/CI PRs as enhancement, not new-card", () => {
    const r = triagePullRequest({
      title: "ci: lossless Apple Pay WebP pipeline",
      body: "- [x] **Not a card** (docs / CI / code) — skip the Card form below",
      changedFiles: [
        "scripts/optimize-images.ts",
        ".github/workflows/optimize-images.yml",
      ],
    });
    assert.equal(r.titleOk, true);
    assert.equal(r.isCardPr, false);
    assert.equal(r.isNewCard, false);
    assert.equal(r.missing.length, 0);
    assert.ok(r.classificationLabelsAdd.includes("enhancement"));
    assert.ok(!r.classificationLabelsAdd.includes("new-card"));
    assert.ok(r.classificationLabelsRemove.includes("new-card"));
    assert.ok(!r.classificationLabelsAdd.includes("documentation"));
    assert.equal(r.completenessLabelsAdd.length, 0);
  });

  it("labels docs PRs as documentation, not new-card", () => {
    const r = triagePullRequest({
      title: "docs: explain Apple Pay card art",
      body: "- [x] **Not a card** (docs / CI / code)",
      changedFiles: ["docs/research/apple-pay-card-art.md", "images/README.md"],
    });
    assert.ok(r.classificationLabelsAdd.includes("documentation"));
    assert.ok(!r.classificationLabelsAdd.includes("new-card"));
    assert.ok(!r.classificationLabelsAdd.includes("enhancement"));
  });

  it("keeps classification labels when form is incomplete", () => {
    const r = triagePullRequest({
      title: "Add card: us-demo-card",
      body: "",
      changedFiles: ["data/us/demo-card.json"],
    });
    assert.ok(r.classificationLabelsAdd.includes("new-card"));
    assert.ok(r.classificationLabelsAdd.includes("US"));
    assert.ok(r.completenessLabelsAdd.includes("needs-info"));
    assert.ok(r.completenessLabelsAdd.includes("pr-form-incomplete"));
    assert.ok(!r.classificationLabelsAdd.includes("needs-info"));
    assert.match(r.commentMarkdown, /Form check failed/);
    assert.match(r.commentMarkdown, /Missing \/ invalid/);
  });

  it("mentions the PR author in the incomplete form comment when PR_AUTHOR is set", () => {
    const prev = process.env.PR_AUTHOR;
    process.env.PR_AUTHOR = "contributor123";
    try {
      const r = triagePullRequest({
        title: "Add card: us-demo-card",
        body: "",
        changedFiles: ["data/us/demo-card.json"],
      });
      assert.match(r.commentMarkdown, /@contributor123/);
      assert.match(r.commentMarkdown, /do \*\*not\*\* open a new PR/i);
    } finally {
      if (prev === undefined) delete process.env.PR_AUTHOR;
      else process.env.PR_AUTHOR = prev;
    }
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
    assert.ok(r.completenessLabelsAdd.includes("needs-info"));
    assert.ok(r.labelsAdd.includes("title-needs-fix"));
    assert.ok(r.completenessLabelsAdd.includes("title-needs-fix"));
  });

  it("accepts no-image checkbox", () => {
    const body = goodBody
      .replace(
        "- [x] **A. Official issuer image URL**",
        "- [ ] **A. Official issuer image URL**",
      )
      .replace(
        "- **Image URL:** https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_preferred_card.png",
        "- **Image URL:** ",
      )
      .replace("- [ ] **D. No image yet**", "- [x] **D. No image yet**");
    const r = triagePullRequest({
      title: "Add card: us-chase-sapphire-preferred",
      body,
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
    });
    assert.equal(r.missing.length, 0);
  });

  it("accepts Apple Pay local upload checkbox with images/ file", () => {
    const body = goodBody
      .replace(
        "- [x] **A. Official issuer image URL**",
        "- [ ] **A. Official issuer image URL**",
      )
      .replace(
        "- **Image URL:** https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_preferred_card.png",
        "- **Image URL:** ",
      )
      .replace(
        "- [ ] **B. Apple Pay extract",
        "- [x] **B. Apple Pay extract",
      );
    const r = triagePullRequest({
      title: "Add card: us-chase-sapphire-preferred",
      body,
      changedFiles: [
        "data/us/chase-sapphire-preferred.json",
        "images/us-chase-sapphire-preferred.png",
      ],
    });
    assert.equal(r.missing.length, 0);
    assert.ok(r.labelsAdd.includes("new-card"));
  });

  it("flags empty Product/Terms lines (must not swallow the next bullet)", () => {
    const r = triagePullRequest({
      title: "Add card: us-demo-card",
      body: `
- [x] **New card**
- **Card ID:** \`us-demo-card\`
- **Product page:**
- **Terms / benefits page:**
- **Last verified (YYYY-MM-DD):** 2026-07-24
- [x] **D. No image yet**
`,
      changedFiles: ["data/us/demo-card.json"],
    });
    assert.ok(r.isNewCard);
    assert.ok(r.missing.some((m) => m.toLowerCase().includes("source")));
    assert.ok(r.labelsAdd.includes("needs-info"));
    assert.ok(r.labelsAdd.includes("missing-sources"));
    assert.ok(r.labelsAdd.includes("pr-form-incomplete"));
  });

  it("flags missing image choice on new-card PRs", () => {
    const r = triagePullRequest({
      title: "Add card: us-demo-card",
      body: `
- [x] **New card**
- **Card ID:** \`us-demo-card\`
- **Product page:** https://creditcards.chase.com/demo
- **Terms / benefits page:** https://chase.com/demo/terms
- **Last verified (YYYY-MM-DD):** 2026-07-24
- [ ] **A. Official issuer image URL**
  - **Image URL:**
- [ ] **B. Apple Pay extract**
- [ ] **C. Other local upload**
- [ ] **D. No image yet**
`,
      changedFiles: ["data/us/demo-card.json"],
    });
    assert.ok(r.missing.some((m) => m.toLowerCase().includes("image")));
    assert.ok(r.labelsAdd.includes("needs-info"));
  });

  it("flags empty-body new-card PR with data file (CI must fail)", () => {
    const r = triagePullRequest({
      title: "Add card: us-demo-card",
      body: "",
      changedFiles: ["data/us/demo-card.json"],
    });
    assert.equal(r.isNewCard, true);
    assert.ok(r.missing.includes("Card ID"));
    assert.ok(r.missing.some((m) => m.toLowerCase().includes("source")));
    assert.ok(r.missing.includes("Last verified (YYYY-MM-DD)"));
    assert.ok(r.missing.some((m) => m.toLowerCase().includes("image")));
    assert.ok(r.labelsAdd.includes("needs-info"));
    assert.ok(r.labelsAdd.includes("new-card"));
  });

  it("flags untouched PR template placeholders for a new card", () => {
    // Mirrors .github/PULL_REQUEST_TEMPLATE.md defaults contributors forget to edit.
    const r = triagePullRequest({
      title: "Add card: us-demo-card",
      body: `
- [x] **New card** (add a file under \`data/us/\`, \`data/ca/\`, or \`data/cn/\`)
- **Card ID:** \`us-example-card\`
- **Product page:** https://www.example-bank.com/cards/example
- **Terms / benefits page:** https://www.example-bank.com/cards/example/terms
- **Last verified (YYYY-MM-DD):** YYYY-MM-DD
- [ ] **A. Official issuer image URL**
  - **Image URL:** https://www.example-bank.com/cardart/example.png
- [ ] **B. Apple Pay extract**
- [ ] **C. Other local upload**
- [ ] **D. No image yet**
`,
      changedFiles: ["data/us/demo-card.json"],
    });
    assert.ok(r.missing.includes("Card ID"));
    assert.ok(r.missing.some((m) => m.toLowerCase().includes("source")));
    assert.ok(r.missing.includes("Last verified (YYYY-MM-DD)"));
    assert.ok(r.missing.some((m) => m.toLowerCase().includes("image")));
    assert.ok(r.labelsAdd.includes("needs-info"));
  });
});
