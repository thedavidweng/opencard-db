import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findSharedImageUrlProblems,
  lintCard,
  lintImageUrl,
  loadLintContext,
} from "../../scripts/validate.ts";
import type { Card } from "../../scripts/lib.ts";

function baseCard(overrides: Record<string, unknown> = {}): Card {
  return {
    id: "us-demo-card",
    country: "us",
    issuer_id: "chase",
    network: "visa",
    network_tier: "signature",
    status: "active",
    name: "Demo Card",
    annual_fee: { amount: 0, currency: "USD" },
    rewards: {
      currency: "points",
      structure: "single",
      base_rate: { points_per_dollar: 1 },
    },
    last_verified: "2026-07-01",
    ...overrides,
  } as Card;
}

describe("semantic lints", () => {
  it("clean card passes", async () => {
    const ctx = await loadLintContext();
    assert.deepEqual(lintCard(baseCard(), ctx), []);
  });

  it("flags issuer alias with canonical suggestion", async () => {
    const ctx = await loadLintContext();
    const problems = lintCard(baseCard({ issuer_id: "first-bankcard" }), ctx);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /use canonical "fnbo"/);
  });

  it("flags unregistered issuer", async () => {
    const ctx = await loadLintContext();
    const problems = lintCard(baseCard({ issuer_id: "totally-new-bank" }), ctx);
    assert.match(problems[0], /not in data\/issuers\.json/);
  });

  it("flags network-prefixed and non-atomic tiers", async () => {
    const ctx = await loadLintContext();
    assert.match(
      lintCard(baseCard({ network_tier: "visa_signature" }), ctx)[0],
      /network-prefixed/,
    );
    assert.match(
      lintCard(baseCard({ network_tier: "signature_or_platinum" }), ctx)[0],
      /not atomic/,
    );
    assert.match(
      lintCard(baseCard({ network_tier: "quicksilver" }), ctx)[0],
      /not in data\/network-tiers\.json/,
    );
  });

  it("flags placeholder categories and rate-less categories", async () => {
    const ctx = await loadLintContext();
    const card = baseCard({
      rewards: {
        currency: "points",
        structure: "multi",
        base_rate: { points_per_dollar: 1 },
        categories: [
          { label: "Category", points_per_dollar: null },
          { label: "Dining", points_per_dollar: null },
          { label: "Travel", points_per_dollar: 3 },
        ],
      },
    });
    const problems = lintCard(card, ctx);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /unfilled placeholder/);
    assert.match(problems[1], /"Dining".*no points_per_dollar/);
  });

  it("flags fraction-encoded percentages unless rate_type is explicit", async () => {
    const ctx = await loadLintContext();
    const fraction = baseCard({
      rewards: {
        currency: "cash_back",
        structure: "single",
        base_rate: { points_per_dollar: 0.015 },
      },
    });
    assert.match(lintCard(fraction, ctx)[0], /fraction-encoded/);

    const explicit = baseCard({
      rewards: {
        currency: "miles",
        rate_type: "miles_multiplier",
        structure: "single",
        base_rate: { points_per_dollar: 0.055 },
      },
    });
    assert.deepEqual(lintCard(explicit, ctx), []);
  });


  it("accepts wayback-wrapped official sources; rejects wrapped foreign domains", async () => {
    const ctx = await loadLintContext();
    const archivedOfficial = baseCard({
      sources: [
        "https://web.archive.org/web/20260101000000/https://creditcards.chase.com/x",
      ],
    });
    assert.deepEqual(lintCard(archivedOfficial, ctx), []);

    const archivedForeign = baseCard({
      sources: [
        "https://web.archive.org/web/20260101000000/https://evil.example.com/x",
      ],
    });
    assert.match(lintCard(archivedForeign, ctx)[0], /not in the domain allowlist/);

    const malformed = baseCard({
      sources: ["https://web.archive.org/web/oops"],
    });
    assert.match(lintCard(malformed, ctx)[0], /malformed web\.archive\.org/);
  });

  it("secondary_sources only on discontinued cards", async () => {
    const ctx = await loadLintContext();
    const active = baseCard({ secondary_sources: ["https://blog.example.com/x"] });
    assert.match(
      lintCard(active, ctx).join(" "),
      /secondary_sources are only permitted on discontinued/,
    );
    const gone = baseCard({
      status: "discontinued",
      discontinued_date: "2026-01-01",
      secondary_sources: ["https://blog.example.com/x"],
    });
    assert.equal(
      lintCard(gone, ctx).some((p) => p.includes("secondary_sources")),
      false,
    );
  });

  it("provenance requires committed art; history must live in images/archive/", async () => {
    const ctx = await loadLintContext();
    const orphan = baseCard({
      image: {
        url: null,
        attribution: null,
        local_path: null,
        provenance: { source: "apple-pay", source_sha256: "a".repeat(64) },
      },
    });
    assert.match(lintCard(orphan, ctx).join(" "), /provenance is set but image\.local_path is null/);

    const badHistory = baseCard({
      image: {
        url: null,
        attribution: null,
        local_path: "images/us-demo-card.webp",
        provenance: { source: "apple-pay", source_sha256: "a".repeat(64) },
        history: [
          { local_path: "images/us-demo-card.old.webp", source: "issuer-site", superseded_at: "2026-07-25" },
        ],
      },
    });
    assert.match(lintCard(badHistory, ctx).join(" "), /must live under images\/archive\//);
  });

  it("flags future dates", async () => {
    const ctx = await loadLintContext();
    assert.match(
      lintCard(baseCard({ last_verified: "2099-01-01" }), ctx)[0],
      /in the future/,
    );
  });

  it("flags fee currency mismatched to country", async () => {
    const ctx = await loadLintContext();
    assert.match(
      lintCard(baseCard({ annual_fee: { amount: 0, currency: "CAD" } }), ctx)[0],
      /does not match country/,
    );
  });

  it("flags scraped page-title names", async () => {
    const ctx = await loadLintContext();
    assert.match(
      lintCard(baseCard({ name: "Coming Soon" }), ctx)[0],
      /scraped page title/,
    );
    assert.match(
      lintCard(
        baseCard({
          name: "Credit Cards: Find & Apply for a Credit Card Online",
        }),
        ctx,
      )[0],
      /scraped page title/,
    );
  });

  it("passes sources/official_url on an issuer's allow-listed domain", async () => {
    const ctx = await loadLintContext();
    const card = baseCard({
      issuer_id: "chase",
      official_url: "https://creditcards.chase.com/rewards/sapphire",
      sources: [
        "https://www.chase.com/personal/credit-cards/sapphire",
        "https://creditcards.chase.com/rewards/sapphire",
      ],
    });
    assert.deepEqual(lintCard(card, ctx), []);
  });

  it("errors on a source domain not in the issuer's allowlist", async () => {
    const ctx = await loadLintContext();
    const card = baseCard({
      issuer_id: "chase",
      official_url: "https://creditcards.chase.com/ok",
      sources: [
        "https://creditcards.chase.com/ok",
        "https://totally-fabricated.example/cards/x",
      ],
    });
    const problems = lintCard(card, ctx);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /sources\[1\]/);
    assert.match(problems[0], /totally-fabricated\.example/);
    assert.match(problems[0], /domain allowlist for issuer "chase"/);
    assert.match(problems[0], /same PR/);
  });

  it("accepts allow-listed co-brand + subdomain hosts (parent-domain match)", async () => {
    const ctx = await loadLintContext();
    // chase allows amazon.com (co-brand); www. is a subdomain of chase.com.
    const card = baseCard({
      issuer_id: "chase",
      official_url: "https://www.amazon.com/dp/prime-card",
      sources: ["https://creditcards.chase.com/amazon"],
    });
    assert.deepEqual(lintCard(card, ctx), []);
  });

  it("skips the domain lint for issuers with no domains allowlist", async () => {
    const ctx = await loadLintContext();
    // Simulate an issuer registered without a domains[] allowlist.
    ctx.issuerDomains.delete("chase");
    const card = baseCard({
      issuer_id: "chase",
      official_url: "https://anything.example/x",
      sources: ["https://anything.example/x"],
    });
    assert.deepEqual(lintCard(card, ctx), []);
  });

  it("flags discontinued_date on an active card and duplicate benefit ids", async () => {
    const ctx = await loadLintContext();
    assert.match(
      lintCard(baseCard({ discontinued_date: "2026-01-01" }), ctx)[0],
      /status is "active"/,
    );
    const card = baseCard({
      benefits: [
        { id: "lounge", title: "L", category: "lounge", source: "network", description: "d" },
        { id: "lounge", title: "L2", category: "lounge", source: "network", description: "d" },
      ],
    });
    assert.match(lintCard(card, ctx)[0], /duplicate benefit id/);
  });

  it("flags Getty stock, social banners, OG images, award badges", async () => {
    const ctx = await loadLintContext();
    assert.equal(
      lintCard(
        baseCard({
          image: {
            url: "https://creditcards.chase.com/K-Marketplace/images/cardart/x.png",
          },
        }),
        ctx,
      ).filter((p) => p.startsWith("image.url")).length,
      0,
    );
    assert.match(
      lintImageUrl(
        "https://www.ace.aaa.com/content/dam/ace/new30-cards/getty-1286018041-mom-and-daughter-shopping-online-1200x800.jpg",
      ) ?? "",
      /Getty/,
    );
    assert.match(
      lintImageUrl(
        "https://creditcards.wellsfargo.com/x/choice_privileges_social_banner_1220x627_english.jpg",
      ) ?? "",
      /social\/OG banner/,
    );
    assert.match(
      lintImageUrl(
        "https://www.apple.com/v/apple-card/n/images/meta/og__dtukeczp0ygm_overview.png",
      ) ?? "",
      /Open Graph/,
    );
    assert.match(
      lintImageUrl(
        "https://www.td.com/content/dam/tdb/images/personal-banking/cashccaward-1-2d-en.png",
      ) ?? "",
      /award badge/,
    );
    assert.equal(
      lintImageUrl(
        "https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_preferred_card.png",
      ),
      null,
    );
  });

  it("allows Quicksilver family to share one official face; rejects cross-product reuse", () => {
    const ok = findSharedImageUrlProblems([
      { id: "us-capital-one-quicksilver", url: "https://ecm.example/qs.png" },
      {
        id: "us-capital-one-quicksilver-secured-cash-rewards",
        url: "https://ecm.example/qs.png",
      },
      {
        id: "us-capital-one-quicksilver-cash-rewards",
        url: "https://ecm.example/qs.png",
      },
    ]);
    assert.deepEqual(ok, []);

    const bad = findSharedImageUrlProblems([
      { id: "us-bank-of-america-air-france-klm", url: "https://bofa.example/cshcm.png" },
      { id: "us-bank-of-america-free-spirit", url: "https://bofa.example/cshcm.png" },
    ]);
    assert.equal(bad.length, 2);
    assert.match(bad[0].message, /us-bank-of-america-free-spirit/);
    assert.match(bad[1].message, /SHARED_ART_FAMILIES/);
  });
});
