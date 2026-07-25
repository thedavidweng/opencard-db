#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

// ajv ships CJS; under NodeNext the default import types as the namespace.
// Runtime (node --experimental-strip-types) resolves the constructor fine.
const Ajv2020 = Ajv2020Import as unknown as typeof Ajv2020Import.default;
const addFormats = addFormatsImport as unknown as typeof addFormatsImport.default;
import {
  expectedIdFromPath,
  loadAllCards,
  loadSchema,
  repoRoot,
  type Card,
} from "./lib.ts";

export type LintContext = {
  issuerIds: Set<string>;
  issuerAliases: Map<string, string>; // alias -> canonical id
  issuerDomains: Map<string, string[]>; // issuer id -> provenance allowlist (empty/absent = not enforced)
  tiers: Set<string>;
  today: string; // YYYY-MM-DD
};

const COUNTRY_CURRENCY: Record<string, string> = {
  us: "USD",
  ca: "CAD",
  cn: "CNY",
};

const NETWORK_NAMES = [
  "visa",
  "mastercard",
  "amex",
  "discover",
  "unionpay",
  "jcb",
];

const PLACEHOLDER_LABEL_RE = /^categor(y|ies)?\s*\d*$/i;
const SCRAPED_NAME_RE =
  /^(credit cards?|travel rewards credit cards|coming soon)$|find & apply/i;

export async function loadLintContext(): Promise<LintContext> {
  const root = repoRoot();
  const issuersRaw = JSON.parse(
    await readFile(path.join(root, "data/issuers.json"), "utf8"),
  ) as { issuers: { id: string; aliases?: string[]; domains?: string[] }[] };
  const tiersRaw = JSON.parse(
    await readFile(path.join(root, "data/network-tiers.json"), "utf8"),
  ) as { tiers: string[] };

  const issuerIds = new Set(issuersRaw.issuers.map((i) => i.id));
  const issuerAliases = new Map<string, string>();
  const issuerDomains = new Map<string, string[]>();
  for (const i of issuersRaw.issuers) {
    for (const a of i.aliases ?? []) issuerAliases.set(a, i.id);
    if (Array.isArray(i.domains) && i.domains.length > 0) {
      issuerDomains.set(
        i.id,
        i.domains.map((d) => d.toLowerCase()),
      );
    }
  }
  return {
    issuerIds,
    issuerAliases,
    issuerDomains,
    tiers: new Set(tiersRaw.tiers),
    today: new Date().toISOString().slice(0, 10),
  };
}

/**
 * A hostname matches an allowlist entry when it equals the registrable domain
 * or is a subdomain of it (parent-domain suffix match) — e.g. both
 * "www.chase.com" and "creditcards.chase.com" match "chase.com".
 */
export function hostnameAllowed(hostname: string, domains: string[]): boolean {
  const h = hostname.toLowerCase();
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Unwrap a Wayback Machine URL to the archived original.
 * "https://web.archive.org/web/20260725000000/https://www.chase.com/x"
 * → "https://www.chase.com/x". An archived official page keeps its
 * provenance: the allowlist is checked against the INNER url. Returns the
 * input unchanged for non-archive URLs; null for a malformed wayback path.
 */
export function unwrapArchiveUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname.toLowerCase() !== "web.archive.org") return url;
  const m = parsed.pathname.match(/^\/web\/[0-9a-z_*]+\/(.+)$/i);
  if (!m) return null;
  let inner = m[1];
  // Wayback drops one slash in "https:/example.com" sometimes; tolerate it.
  inner = inner.replace(/^(https?):\/+/i, "$1://");
  try {
    new URL(inner);
    return inner;
  } catch {
    return null;
  }
}

function tierProblem(tier: string, ctx: LintContext): string | null {
  if (ctx.tiers.has(tier)) return null;
  if (tier.includes(":")) {
    return `network_tier "${tier}" must not embed the network (use the bare package slug)`;
  }
  const prefixed = NETWORK_NAMES.find((n) => tier.startsWith(`${n}_`));
  if (prefixed) {
    return `network_tier "${tier}" is network-prefixed — the network lives in its own field; use "${tier.slice(prefixed.length + 1)}"`;
  }
  if (tier.includes("_or_")) {
    return `network_tier "${tier}" is not atomic — record the tier actually issued (or use additional_networks)`;
  }
  return `network_tier "${tier}" is not in data/network-tiers.json — fix the tier, or extend the allowlist in the same PR if it is a real network package`;
}

/**
 * Semantic lints beyond ajv. Returns human-readable problems for one card.
 */
export function lintCard(card: Card, ctx: LintContext): string[] {
  const problems: string[] = [];

  // Issuer registry
  if (!ctx.issuerIds.has(card.issuer_id)) {
    const canonical = ctx.issuerAliases.get(card.issuer_id);
    problems.push(
      canonical
        ? `issuer_id "${card.issuer_id}" is a known alias — use canonical "${canonical}"`
        : `issuer_id "${card.issuer_id}" is not in data/issuers.json — add the issuer there in this PR (id, name, aliases)`,
    );
  }

  // Source-domain provenance allowlist (anti-fabrication). sources[] and
  // official_url are the repo's provenance backbone, so an off-allowlist host
  // is an ERROR: either the issuer registry is missing a legitimate new domain
  // (add it to data/issuers.json in this PR) or the source is fabricated /
  // points at the wrong issuer.
  const allowed = ctx.issuerDomains.get(card.issuer_id);
  if (allowed && allowed.length > 0) {
    const provenance: { field: string; url: string }[] = [];
    if (typeof card.official_url === "string") {
      provenance.push({ field: "official_url", url: card.official_url });
    }
    const sources = card.sources as unknown;
    if (Array.isArray(sources)) {
      sources.forEach((s, i) => {
        if (typeof s === "string") {
          provenance.push({ field: `sources[${i}]`, url: s });
        }
      });
    }
    for (const { field, url } of provenance) {
      // Archived official pages count as official: validate the inner URL.
      const effective = unwrapArchiveUrl(url);
      if (effective === null) {
        problems.push(
          `${field} is a malformed web.archive.org URL — use the full "https://web.archive.org/web/<timestamp>/<original-url>" form`,
        );
        continue;
      }
      let hostname: string;
      try {
        hostname = new URL(effective).hostname;
      } catch {
        // Malformed URL — the ajv "format": "uri" check already reports it.
        continue;
      }
      if (!hostnameAllowed(hostname, allowed)) {
        problems.push(
          `${field} host "${hostname.toLowerCase()}" is not in the domain allowlist for issuer "${card.issuer_id}" (data/issuers.json → domains). If this is a legitimate issuer/co-brand source, add the domain to that issuer's "domains" in this same PR; otherwise the source may be fabricated or point at the wrong issuer.`,
        );
      }
    }
  }

  // Tier allowlist (primary + additional networks)
  const tiers: string[] = [card.network_tier];
  const extra = card.additional_networks as
    | { network_tier: string }[]
    | undefined;
  for (const an of extra ?? []) tiers.push(an.network_tier);
  for (const t of tiers) {
    const p = tierProblem(t, ctx);
    if (p) problems.push(p);
  }

  // Scraped page-title instead of a product name
  if (SCRAPED_NAME_RE.test(card.name.trim())) {
    problems.push(
      `name "${card.name}" looks like a scraped page title, not a product name`,
    );
  }

  // Rewards: placeholder categories, missing category rates, fraction encoding
  const rewards = card.rewards as
    | {
        rate_type?: string;
        structure?: string;
        base_rate?: { points_per_dollar?: number | null };
        categories?: {
          label?: string;
          points_per_dollar?: number | null;
        }[];
      }
    | undefined;
  for (const [i, cat] of (rewards?.categories ?? []).entries()) {
    const label = (cat.label ?? "").trim();
    if (PLACEHOLDER_LABEL_RE.test(label) || label.length === 0) {
      problems.push(
        `rewards.categories[${i}] is an unfilled placeholder (label "${cat.label}") — fill the real bonus category or remove the entry`,
      );
    } else if (cat.points_per_dollar == null) {
      problems.push(
        `rewards.categories[${i}] ("${label}") has no points_per_dollar — a listed bonus category must carry its rate`,
      );
    }
  }
  if (rewards && rewards.rate_type == null) {
    const rates = [
      rewards.base_rate?.points_per_dollar,
      ...(rewards.categories ?? []).map((c) => c.points_per_dollar),
    ];
    for (const r of rates) {
      if (typeof r === "number" && r > 0 && r < 0.5) {
        problems.push(
          `rewards rate ${r} looks like a fraction-encoded percentage — use the whole-number convention (1.5 means 1.5% / 1.5x), or set rewards.rate_type explicitly if a sub-0.5 multiplier is real`,
        );
        break;
      }
    }
  }

  // Dates must not be in the future
  const lastVerified = card.last_verified as string | undefined;
  if (lastVerified && lastVerified > ctx.today) {
    problems.push(`last_verified "${lastVerified}" is in the future`);
  }
  const asOf = (card.signup_bonus as { as_of?: string | null } | null)?.as_of;
  if (asOf && asOf > ctx.today) {
    problems.push(`signup_bonus.as_of "${asOf}" is in the future`);
  }

  // Fee currency must match the card's market
  const expectedCurrency = COUNTRY_CURRENCY[card.country];
  const feeCurrency = (card.annual_fee as { currency?: string } | undefined)
    ?.currency;
  if (expectedCurrency && feeCurrency && feeCurrency !== expectedCurrency) {
    problems.push(
      `annual_fee.currency "${feeCurrency}" does not match country "${card.country}" (expected ${expectedCurrency})`,
    );
  }

  // Lifecycle coherence
  if (card.discontinued_date && card.status !== "discontinued") {
    problems.push(
      `discontinued_date set but status is "${card.status}" (expected "discontinued")`,
    );
  }

  // secondary_sources are a lower-confidence tier for cards whose official
  // pages are gone — active cards must stick to official (or archived) pages.
  const secondary = card.secondary_sources as unknown;
  if (Array.isArray(secondary) && secondary.length > 0 && card.status !== "discontinued") {
    problems.push(
      `secondary_sources are only permitted on discontinued cards — active cards must cite official pages in sources (use a web.archive.org snapshot of the official page if the live page moved)`,
    );
  }

  // Art provenance coherence: provenance describes COMMITTED art.
  const image = card.image as
    | {
        local_path?: string | null;
        provenance?: { source?: string } | null;
        history?: unknown[];
      }
    | null
    | undefined;
  if (image?.provenance && !image.local_path) {
    problems.push(
      `image.provenance is set but image.local_path is null — provenance describes the committed art file; add the file (or drop the provenance block)`,
    );
  }
  if (Array.isArray(image?.history)) {
    for (const [i, h] of image.history.entries()) {
      const lp = (h as { local_path?: string }).local_path ?? "";
      if (!lp.startsWith("images/archive/")) {
        problems.push(
          `image.history[${i}].local_path "${lp}" must live under images/archive/ (superseded art is moved there, never overwritten)`,
        );
      }
    }
  }

  // benefit.id uniqueness within the card
  const benefitIds = new Set<string>();
  for (const b of (card.benefits as { id?: string }[] | undefined) ?? []) {
    if (!b.id) continue;
    if (benefitIds.has(b.id)) {
      problems.push(`duplicate benefit id "${b.id}" within the card`);
    }
    benefitIds.add(b.id);
  }

  return problems;
}

function emit(file: string, message: string, errors: string[]): void {
  errors.push(`${file}: ${message}`);
  if (process.env.GITHUB_ACTIONS) {
    // Inline annotation on the PR diff.
    console.log(`::error file=${file}::${message.replace(/\n/g, " ")}`);
  }
}

async function main(): Promise<void> {
  const root = repoRoot();
  const schema = await loadSchema();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const ctx = await loadLintContext();

  const loaded = await loadAllCards();
  if (loaded.length === 0) {
    console.warn("warning: no card JSON files under data/");
  }

  const errors: string[] = [];
  const seen = new Map<string, string>();
  const allIds = new Set(loaded.map(({ card }) => card.id));

  for (const { file, card } of loaded) {
    const rel = path.relative(root, file);

    const ok = validate(card);
    if (!ok) {
      for (const e of validate.errors ?? []) {
        emit(
          rel,
          `schema invalid — ${e.instancePath || "/"} ${e.message}`,
          errors,
        );
      }
    }

    const expected = expectedIdFromPath(file);
    if (card.id !== expected.id) {
      emit(
        rel,
        `id "${card.id}" does not match path-derived id "${expected.id}"`,
        errors,
      );
    }
    if (card.country !== expected.country) {
      emit(
        rel,
        `country "${card.country}" does not match directory "${expected.country}"`,
        errors,
      );
    }

    const prev = seen.get(card.id);
    if (prev) {
      emit(rel, `duplicate id "${card.id}" (also in ${prev})`, errors);
    } else {
      seen.set(card.id, rel);
    }

    const replacedBy = card.replaced_by as string | undefined;
    if (replacedBy && !allIds.has(replacedBy)) {
      emit(
        rel,
        `replaced_by "${replacedBy}" does not reference an existing card id`,
        errors,
      );
    }

    for (const p of lintCard(card, ctx)) {
      emit(rel, p, errors);
    }
  }

  if (errors.length) {
    for (const m of errors) console.error(`error: ${m}`);
    process.exit(1);
  }
  console.log(`ok: ${loaded.length} card(s) validated`);
}

const isDirectRun =
  process.argv[1] != null &&
  import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

export type { Card };
