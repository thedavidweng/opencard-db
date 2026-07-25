import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintCard, loadLintContext } from "../../scripts/validate.ts";
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
});
