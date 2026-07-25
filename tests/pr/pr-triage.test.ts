import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareIsoDates,
  detectRegions,
  diffCardFields,
  findDuplicatePrs,
  highImpactChanges,
  isMaintainer,
  parseTitle,
  renderDiffTable,
  suggestTitle,
  triagePullRequest,
  urlHostname,
  type CardKeyFields,
} from "../../scripts/pr-triage.ts";
import { extractKeyFields } from "../../scripts/build-base-cards.ts";

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

  it("detects duplicate open card PRs and links them", () => {
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

  it("does not flag prefix-collision slugs as duplicates", () => {
    const dups = findDuplicatePrs(
      ["us-amex-gold"],
      [
        {
          number: 43,
          title: "card(add): us-amex-gold-star",
          url: "https://github.com/thedavidweng/opencard-db/pull/43",
          author: "other-dev",
        },
      ],
      99,
    );
    assert.equal(dups.length, 0);
  });

  it("duplicate-pr is a warning, not a hard failure", () => {
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
    const dup = r.issues.find((i) => i.code === "duplicate-pr");
    assert.ok(dup);
    assert.equal(dup.severity, "warn");
    // Same pass/fail rule as run-pr-triage.ts: a duplicate alone must not fail.
    assert.equal(r.titleOk, true);
    assert.equal(r.issues.some((i) => i.severity === "error"), false);
    assert.equal(r.missing.length, 0);
  });


  it("maintenance escape: Not-a-card + meta title skips card form for bulk data PRs", () => {
    const body = "- [x] **Not a card** (docs / CI / code / bulk data maintenance)";
    const files = [
      "data/us/a.json",
      "data/us/b.json",
      "data/ca/c.json",
      "scripts/validate.ts",
    ];
    const r = triagePullRequest({
      title: "feat(schema): backfill segment across all cards",
      body,
      changedFiles: files,
      currentPrNumber: 99,
      openCardPrs: [],
      baseCards: {},
    });
    assert.equal(r.titleOk, true);
    assert.equal(r.issues.some((i) => i.severity === "error"), false);
    assert.equal(r.missing.length, 0);
    const note = r.issues.find((i) => i.code === "maintenance-bulk-data");
    assert.ok(note);
    assert.equal(note.severity, "warn");
  });

  it("maintenance escape does NOT apply without the Not-a-card checkbox", () => {
    const r = triagePullRequest({
      title: "feat(schema): backfill segment across all cards",
      body: "",
      changedFiles: ["data/us/a.json", "data/us/b.json"],
      currentPrNumber: 99,
      openCardPrs: [],
      baseCards: {},
    });
    assert.ok(r.issues.some((i) => i.code === "one-card-per-pr"));
  });

  it("maintenance escape does NOT apply to card(add) titles", () => {
    const body = "- [x] **Not a card** (docs / CI / code / bulk data maintenance)";
    const r = triagePullRequest({
      title: "card(add): us-demo-card",
      body,
      changedFiles: ["data/us/demo-card.json", "data/us/other.json"],
      currentPrNumber: 99,
      openCardPrs: [],
      baseCards: {},
    });
    assert.ok(r.issues.some((i) => i.code === "one-card-per-pr"));
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

  it("warns (not fails) on same-day Update; rejects older last_verified", () => {
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
    const sameIssue = same.issues.find(
      (i) => i.code === "last-verified-unchanged",
    );
    assert.ok(sameIssue);
    assert.equal(sameIssue.severity, "warn");
    assert.equal(same.missing.length, 0);

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

// --- Truth signals: update diffs + high-impact flags (anti-vandalism) -------

function keyFields(overrides: Partial<CardKeyFields> = {}): CardKeyFields {
  return {
    name: "Chase Demo",
    issuer_id: "chase",
    network: "visa",
    network_tier: "signature",
    annual_fee_amount: 95,
    fx_fee_percent: 0,
    base_rate_points_per_dollar: 1,
    official_url: "https://creditcards.chase.com/demo",
    status: "active",
    segment: "personal",
    ...overrides,
  };
}

const CHASE_UPDATE_BODY = `
- [ ] **New card**
- [x] **Update existing card**
- **Card ID:** \`us-chase-demo\`
- **Product page:** https://creditcards.chase.com/demo
- **Last verified (YYYY-MM-DD):** 2026-07-20
- [x] **D. No image yet**
`;

function updateTriage(
  base: CardKeyFields,
  head: CardKeyFields,
  extra: { prAuthor?: string } = {},
) {
  const path = "data/us/chase-demo.json";
  return triagePullRequest({
    title: "card(update): us-chase-demo",
    body: CHASE_UPDATE_BODY,
    changedFiles: [path],
    prAuthor: extra.prAuthor ?? "thedavidweng",
    baseCards: {
      [path]: {
        path,
        exists: true,
        last_verified: "2026-07-01",
        base,
        head,
      },
    },
  });
}

describe("truth signals: update diff table", () => {
  it("urlHostname extracts host and tolerates junk", () => {
    assert.equal(
      urlHostname("https://creditcards.chase.com/x"),
      "creditcards.chase.com",
    );
    assert.equal(urlHostname("not a url"), null);
    assert.equal(urlHostname(null), null);
  });

  it("diffs only the key fields that changed", () => {
    const rows = diffCardFields(
      keyFields(),
      keyFields({ name: "Renamed", annual_fee_amount: 250 }),
    );
    assert.deepEqual(
      rows.map((r) => r.field).sort(),
      ["annual_fee.amount", "name"],
    );
    const nameRow = rows.find((r) => r.field === "name");
    assert.match(nameRow!.old, /Chase Demo/);
    assert.match(nameRow!.new, /Renamed/);
  });

  it("renders a markdown table (null when nothing changed)", () => {
    assert.equal(renderDiffTable([]), null);
    const table = renderDiffTable(diffCardFields(keyFields(), keyFields({ status: "discontinued" })));
    assert.match(table!, /\| Field \| Old/);
    assert.match(table!, /`status`/);
  });

  it("puts the diff table + reviewer warning in the sticky comment", () => {
    const r = updateTriage(keyFields(), keyFields({ annual_fee_amount: 550 }));
    assert.match(r.commentMarkdown, /Key field changes — `us-chase-demo`/);
    assert.match(r.commentMarkdown, /annual_fee\.amount/);
    assert.match(r.commentMarkdown, /REVIEWING\.md/);
  });
});

describe("truth signals: high-impact flags", () => {
  it("no flags when nothing high-impact changed", () => {
    // base_rate change is diffed but not high-impact
    assert.deepEqual(
      highImpactChanges(
        "us-chase-demo",
        keyFields(),
        keyFields({ base_rate_points_per_dollar: 2 }),
      ),
      [],
    );
    const r = updateTriage(
      keyFields(),
      keyFields({ base_rate_points_per_dollar: 2 }),
    );
    assert.ok(!r.completenessLabelsAdd.includes("high-impact-change"));
    assert.ok(r.completenessLabelsRemove.includes("high-impact-change"));
  });

  it("flags an annual-fee jump over $100 (warn)", () => {
    const hi = highImpactChanges(
      "us-chase-demo",
      keyFields({ annual_fee_amount: 95 }),
      keyFields({ annual_fee_amount: 550 }),
    );
    const fee = hi.find((i) => i.code === "high-impact-annual-fee");
    assert.equal(fee?.severity, "warn");
    // a $30 bump does not flag
    assert.equal(
      highImpactChanges(
        "us-chase-demo",
        keyFields({ annual_fee_amount: 95 }),
        keyFields({ annual_fee_amount: 125 }),
      ).length,
      0,
    );
  });

  it("flags an annual-fee change to/from null (warn)", () => {
    const hi = highImpactChanges(
      "us-chase-demo",
      keyFields({ annual_fee_amount: 0 }),
      keyFields({ annual_fee_amount: null }),
    );
    assert.ok(hi.some((i) => i.code === "high-impact-annual-fee"));
  });

  it("flags a network flip and a network_tier flip (warn)", () => {
    const net = highImpactChanges(
      "us-chase-demo",
      keyFields({ network: "visa" }),
      keyFields({ network: "mastercard" }),
    );
    assert.equal(
      net.find((i) => i.code === "high-impact-network")?.severity,
      "warn",
    );
    const tier = highImpactChanges(
      "us-chase-demo",
      keyFields({ network_tier: "signature" }),
      keyFields({ network_tier: "world_elite" }),
    );
    assert.ok(tier.some((i) => i.code === "high-impact-network-tier"));
  });

  it("flags an official_url hostname change (warn), ignoring path-only edits", () => {
    const hostChange = highImpactChanges(
      "us-chase-demo",
      keyFields({ official_url: "https://creditcards.chase.com/a" }),
      keyFields({ official_url: "https://phishing.example/a" }),
    );
    assert.equal(
      hostChange.find((i) => i.code === "high-impact-official-url")?.severity,
      "warn",
    );
    // same host, different path → not flagged
    assert.equal(
      highImpactChanges(
        "us-chase-demo",
        keyFields({ official_url: "https://creditcards.chase.com/a" }),
        keyFields({ official_url: "https://creditcards.chase.com/b" }),
      ).length,
      0,
    );
  });

  it("flags status change to discontinued (warn)", () => {
    const hi = highImpactChanges(
      "us-chase-demo",
      keyFields({ status: "active" }),
      keyFields({ status: "discontinued" }),
    );
    assert.ok(hi.some((i) => i.code === "high-impact-status-discontinued"));
  });

  it("treats an issuer_id change as an ERROR that fails the form", () => {
    const hi = highImpactChanges(
      "us-chase-demo",
      keyFields({ issuer_id: "chase" }),
      keyFields({ issuer_id: "citi" }),
    );
    const err = hi.find((i) => i.code === "high-impact-issuer-id");
    assert.equal(err?.severity, "error");

    const r = updateTriage(
      keyFields({ issuer_id: "chase" }),
      keyFields({ issuer_id: "citi" }),
    );
    assert.ok(r.issues.some((i) => i.code === "high-impact-issuer-id"));
    assert.ok(r.missing.length > 0, "issuer_id change must fail the form");
    assert.ok(r.completenessLabelsAdd.includes("high-impact-change"));
  });

  it("adds the high-impact-change label on a flagged update", () => {
    const r = updateTriage(keyFields(), keyFields({ network: "mastercard" }));
    assert.ok(r.completenessLabelsAdd.includes("high-impact-change"));
    assert.match(r.commentMarkdown, /High-impact fields changed/);
  });
});

describe("truth signals: provenance / needs-verification", () => {
  it("isMaintainer recognizes the repo owner (case/@-insensitive)", () => {
    assert.equal(isMaintainer("thedavidweng"), true);
    assert.equal(isMaintainer("@TheDavidWeng"), true);
    assert.equal(isMaintainer("random-contributor"), false);
    assert.equal(isMaintainer(""), false);
    assert.equal(isMaintainer(undefined), false);
  });

  it("adds needs-verification for a non-maintainer new card", () => {
    const r = triagePullRequest({
      title: "card(add): us-chase-sapphire-preferred",
      body: goodBody,
      changedFiles: ["data/us/chase-sapphire-preferred.json"],
      prAuthor: "external-contributor",
      baseCards: {
        "data/us/chase-sapphire-preferred.json": {
          path: "data/us/chase-sapphire-preferred.json",
          exists: false,
          last_verified: null,
        },
      },
    });
    assert.ok(r.issues.some((i) => i.code === "needs-verification"));
    assert.ok(r.completenessLabelsAdd.includes("needs-verification"));
    assert.match(r.commentMarkdown, /verify the identity fields/);
  });

  it("adds needs-verification for a non-maintainer update", () => {
    const r = updateTriage(keyFields(), keyFields(), {
      prAuthor: "external-contributor",
    });
    const note = r.issues.find((i) => i.code === "needs-verification");
    assert.ok(note);
    assert.equal(note.severity, "warn");
    assert.ok(r.completenessLabelsAdd.includes("needs-verification"));
  });

  it("skips needs-verification for a maintainer-authored PR", () => {
    const r = updateTriage(keyFields(), keyFields(), {
      prAuthor: "thedavidweng",
    });
    assert.ok(!r.issues.some((i) => i.code === "needs-verification"));
    assert.ok(r.completenessLabelsRemove.includes("needs-verification"));
  });
});

describe("build-base-cards: extractKeyFields (pure)", () => {
  it("extracts nested key fields and null-safes junk", () => {
    const raw = JSON.stringify({
      name: "X",
      issuer_id: "chase",
      network: "visa",
      network_tier: "signature",
      annual_fee: { amount: 95 },
      fx_fee: { percent: 0 },
      rewards: { base_rate: { points_per_dollar: 1.5 } },
      official_url: "https://creditcards.chase.com/x",
      status: "active",
      segment: "personal",
    });
    assert.deepEqual(extractKeyFields(raw), {
      name: "X",
      issuer_id: "chase",
      network: "visa",
      network_tier: "signature",
      annual_fee_amount: 95,
      fx_fee_percent: 0,
      base_rate_points_per_dollar: 1.5,
      official_url: "https://creditcards.chase.com/x",
      status: "active",
      segment: "personal",
    });
  });

  it("returns null for missing/invalid blobs", () => {
    assert.equal(extractKeyFields(null), null);
    assert.equal(extractKeyFields("{ not json"), null);
  });

  it("null-safes a missing annual_fee.amount and absent segment", () => {
    const raw = JSON.stringify({ name: "X", annual_fee: {} });
    const f = extractKeyFields(raw)!;
    assert.equal(f.annual_fee_amount, null);
    assert.equal(f.segment, null);
  });
});
