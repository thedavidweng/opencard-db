import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareIsoDates,
  detectRegions,
  findDuplicatePrs,
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

const updateBody = goodBody
  .replace("- [x] **New card**", "- [ ] **New card**")
  .replace("- [ ] **Update existing card**", "- [x] **Update existing card**")
  .replace("2026-07-24", "2026-07-28");

describe("pr triage", () => {
  it("parses card and Conventional Commits titles", () => {
    assert.equal(parseTitle("card(add): us-amex-gold").ok, true);
    assert.equal(parseTitle("card(add): us-amex-gold").kind, "add-card");
    assert.equal(parseTitle("card(update): ca-amex-cobalt").kind, "update-card");
    // Legacy prose titles still accepted
    assert.equal(parseTitle("Add card: us-amex-gold").ok, true);
    assert.equal(parseTitle("Update card: ca-amex-cobalt").kind, "update-card");
    assert.equal(parseTitle("docs: fix contributing").ok, true);
    assert.equal(parseTitle("feat(pr-checks): detect duplicates").ok, true);
    assert.equal(parseTitle("feat(pr-checks): detect duplicates").kind, "meta");
    assert.equal(parseTitle("fix!: breaking payment path").ok, true);
    assert.equal(parseTitle("card: us-amex-gold").ok, false);
    assert.equal(parseTitle("card(new): us-amex-gold").ok, false);
    assert.equal(parseTitle("Add a new sapphire card").ok, false);
    assert.equal(parseTitle("feat add cards without colon").ok, false);
  });

  it("labels feat: PRs as enhancement (Conventional Commits)", () => {
    const r = triagePullRequest({
      title: "feat(pr-checks): duplicate card PRs + last_verified comparison",
      body: "- [x] **Not a card** (docs / CI / code) — skip the Card form below",
      changedFiles: ["scripts/pr-triage.ts", ".github/workflows/pr-checks.yml"],
    });
    assert.equal(r.titleOk, true);
    assert.equal(r.isCardPr, false);
    assert.ok(r.classificationLabelsAdd.includes("enhancement"));
    assert.ok(!r.classificationLabelsAdd.includes("new-card"));
    assert.equal(r.issues.filter((i) => i.severity === "error").length, 0);
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
      "card(add): us-chase-sapphire-preferred",
    );
  });

  it("passes a complete new-card PR when the file is new on base", () => {
    const r = triagePullRequest({
      title: "card(add): us-chase-sapphire-preferred",
      body: goodBody,
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
      baseCards: {
        "data/us/chase-sapphire-preferred.json": {
          path: "data/us/chase-sapphire-preferred.json",
          exists: false,
          last_verified: null,
        },
      },
    });
    assert.equal(r.titleOk, true);
    assert.equal(r.issues.filter((i) => i.severity === "error").length, 0);
    assert.ok(r.classificationLabelsAdd.includes("new-card"));
    assert.ok(!r.completenessLabelsAdd.includes("needs-info"));
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
    assert.equal(r.isCardPr, false);
    assert.ok(r.classificationLabelsAdd.includes("enhancement"));
    assert.ok(!r.classificationLabelsAdd.includes("new-card"));
  });

  it("labels docs PRs as documentation, not new-card", () => {
    const r = triagePullRequest({
      title: "docs: explain Apple Pay card art",
      body: "- [x] **Not a card** (docs / CI / code)",
      changedFiles: ["docs/research/apple-pay-card-art.md"],
    });
    assert.ok(r.classificationLabelsAdd.includes("documentation"));
  });

  it("keeps classification labels when form is incomplete", () => {
    const r = triagePullRequest({
      title: "card(add): us-demo-card",
      body: "",
      changedFiles: ["data/us/demo-card.json"],
    });
    assert.ok(r.classificationLabelsAdd.includes("new-card"));
    assert.ok(r.completenessLabelsAdd.includes("needs-info"));
    assert.match(r.commentMarkdown, /Form check failed/);
  });

  it("mentions the PR author when PR_AUTHOR is set", () => {
    const prev = process.env.PR_AUTHOR;
    process.env.PR_AUTHOR = "contributor123";
    try {
      const r = triagePullRequest({
        title: "card(add): us-demo-card",
        body: "",
        changedFiles: ["data/us/demo-card.json"],
      });
      assert.match(r.commentMarkdown, /@contributor123/);
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
          /https:\/\/creditcards\.chase\.com\/rewards-credit-cards\/sapphire\/preferred/,
          "https://www.example-bank.com/cards/example",
        )
        .replace(
          /https:\/\/www\.chase\.com\/personal\/credit-cards\/sapphire\/preferred/,
          "https://www.example-bank.com/cards/example/terms",
        )
        .replace(
          /https:\/\/creditcards\.chase\.com\/K-Marketplace\/images\/cardart\/sapphire_preferred_card\.png/,
          "https://www.example-bank.com/cardart/example.png",
        ),
      changedFiles: ["data/us/example-card.json"],
      baseCards: {
        "data/us/example-card.json": {
          path: "data/us/example-card.json",
          exists: false,
          last_verified: null,
        },
      },
    });
    assert.equal(r.titleOk, false);
    assert.ok(r.issues.some((i) => i.code === "card-id"));
    assert.ok(r.issues.some((i) => i.code === "sources"));
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
      title: "card(add): us-chase-sapphire-preferred",
      body,
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
      baseCards: {
        "data/us/chase-sapphire-preferred.json": {
          path: "data/us/chase-sapphire-preferred.json",
          exists: false,
          last_verified: null,
        },
      },
    });
    assert.equal(r.issues.filter((i) => i.severity === "error").length, 0);
  });

  it("flags empty Product/Terms lines without swallowing the next bullet", () => {
    const r = triagePullRequest({
      title: "card(add): us-demo-card",
      body: `
- [x] **New card**
- **Card ID:** \`us-demo-card\`
- **Product page:**
- **Terms / benefits page:**
- **Last verified (YYYY-MM-DD):** 2026-07-24
- [x] **D. No image yet**
`,
      changedFiles: ["data/us/demo-card.json"],
      baseCards: {
        "data/us/demo-card.json": {
          path: "data/us/demo-card.json",
          exists: false,
          last_verified: null,
        },
      },
    });
    assert.ok(r.issues.some((i) => i.code === "sources"));
  });

  it("flags missing image choice on new-card PRs", () => {
    const r = triagePullRequest({
      title: "card(add): us-demo-card",
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
      baseCards: {
        "data/us/demo-card.json": {
          path: "data/us/demo-card.json",
          exists: false,
          last_verified: null,
        },
      },
    });
    assert.ok(r.issues.some((i) => i.code === "image"));
  });

  it("detects duplicate open Add card PRs and links them", () => {
    const r = triagePullRequest({
      title: "card(add): us-demo-card",
      body: goodBody.replace(/us-chase-sapphire-preferred/g, "us-demo-card"),
      changedFiles: ["data/us/demo-card.json"],
      currentPrNumber: 99,
      openCardPrs: [
        {
          number: 42,
          title: "card(add): us-demo-card",
          url: "https://github.com/thedavidweng/opencard-db/pull/42",
          author: "other-dev",
        },
      ],
      baseCards: {
        "data/us/demo-card.json": {
          path: "data/us/demo-card.json",
          exists: false,
          last_verified: null,
        },
      },
    });
    assert.equal(r.duplicatePrs.length, 1);
    assert.ok(r.issues.some((i) => i.code === "duplicate-pr"));
    assert.ok(r.completenessLabelsAdd.includes("duplicate"));
    assert.match(r.commentMarkdown, /#42/);
    assert.match(r.commentMarkdown, /pull\/42/);
  });

  it("findDuplicatePrs ignores the current PR number", () => {
    const dups = findDuplicatePrs(
      ["us-demo-card"],
      [
        {
          number: 99,
          title: "card(add): us-demo-card",
          url: "https://example/99",
        },
        {
          number: 7,
          title: "card(add): us-demo-card",
          url: "https://example/7",
        },
      ],
      99,
    );
    assert.deepEqual(
      dups.map((d) => d.number),
      [7],
    );
  });

  it("rejects Add when the card already exists on the base branch", () => {
    const r = triagePullRequest({
      title: "card(add): us-chase-sapphire-preferred",
      body: goodBody,
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
      baseCards: {
        "data/us/chase-sapphire-preferred.json": {
          path: "data/us/chase-sapphire-preferred.json",
          exists: true,
          last_verified: "2026-07-01",
        },
      },
    });
    assert.ok(r.issues.some((i) => i.code === "already-exists"));
    assert.match(r.commentMarkdown, /card\(update\):/);
  });

  it("rejects Update when last_verified is not newer than base", () => {
    const same = triagePullRequest({
      title: "card(update): us-chase-sapphire-preferred",
      body: updateBody.replace("2026-07-28", "2026-07-10"),
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
      baseCards: {
        "data/us/chase-sapphire-preferred.json": {
          path: "data/us/chase-sapphire-preferred.json",
          exists: true,
          last_verified: "2026-07-10",
        },
      },
    });
    assert.ok(same.issues.some((i) => i.code === "last-verified-unchanged"));

    const older = triagePullRequest({
      title: "card(update): us-chase-sapphire-preferred",
      body: updateBody.replace("2026-07-28", "2026-07-01"),
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
      baseCards: {
        "data/us/chase-sapphire-preferred.json": {
          path: "data/us/chase-sapphire-preferred.json",
          exists: true,
          last_verified: "2026-07-10",
        },
      },
    });
    assert.ok(older.issues.some((i) => i.code === "last-verified-older"));
    assert.ok(compareIsoDates("2026-07-01", "2026-07-10") < 0);
  });

  it("accepts Update when last_verified is newer than base", () => {
    const r = triagePullRequest({
      title: "card(update): us-chase-sapphire-preferred",
      body: updateBody,
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
      baseCards: {
        "data/us/chase-sapphire-preferred.json": {
          path: "data/us/chase-sapphire-preferred.json",
          exists: true,
          last_verified: "2026-07-10",
        },
      },
    });
    assert.equal(r.issues.filter((i) => i.severity === "error").length, 0);
    assert.ok(!r.classificationLabelsAdd.includes("new-card"));
  });

  it("rejects Update when the card does not exist on base", () => {
    const r = triagePullRequest({
      title: "card(update): us-brand-new-card",
      body: updateBody.replace(/us-chase-sapphire-preferred/g, "us-brand-new-card"),
      changedFiles: ["data/us/brand-new-card.json"],
      baseCards: {
        "data/us/brand-new-card.json": {
          path: "data/us/brand-new-card.json",
          exists: false,
          last_verified: null,
        },
      },
    });
    assert.ok(r.issues.some((i) => i.code === "does-not-exist"));
  });
});
