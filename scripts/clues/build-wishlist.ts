#!/usr/bin/env node
/**
 * Build a clue wishlist from third-party open datasets.
 *
 * Sources are DISCOVERY CLUES ONLY (never copy into Card `sources`):
 *   - npm `credit-card-db-api` (~54 cards)
 *   - GitHub `andenacitelli/credit-card-bonuses-api` (~175 cards)
 *
 * Usage:
 *   node --experimental-strip-types scripts/clues/build-wishlist.ts
 *
 * Optional: place fresh dumps at:
 *   clues/raw/credit-card-db-api.json
 *   clues/raw/credit-card-bonuses-api.json
 * otherwise the script fetches / reads from node_modules when available.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

type ClueCard = {
  clue_sources: string[];
  name: string;
  issuer: string;
  network: string | null;
  url: string | null;
  annual_fee: number | string | null;
  is_business: boolean;
  discontinued: boolean;
  image_url: string | null;
  proposed_id: string;
  country: "us";
  norm: string;
  status_vs_repo: "covered" | "likely_covered" | "missing";
  matched_id: string | null;
  matched_where: string | null;
};

const ISSUER_SLUG: Record<string, string> = {
  AMERICAN_EXPRESS: "amex",
  "AMERICAN EXPRESS": "amex",
  AMEX: "amex",
  CHASE: "chase",
  "CAPITAL ONE": "capital-one",
  CAPITAL_ONE: "capital-one",
  CITI: "citi",
  CITIBANK: "citi",
  DISCOVER: "discover",
  "WELLS FARGO": "wells-fargo",
  WELLS_FARGO: "wells-fargo",
  "BANK OF AMERICA": "bank-of-america",
  BANK_OF_AMERICA: "bank-of-america",
  "US BANK": "us-bank",
  "U.S. BANK": "us-bank",
  US_BANK: "us-bank",
  BARCLAYS: "barclays",
  SYNCHRONY: "synchrony",
  "GOLDMAN SACHS": "goldman-sachs",
  GOLDMAN_SACHS: "goldman-sachs",
  PNC: "pnc",
  APPLE: "apple",
  BREX: "brex",
  SOFI: "sofi",
  FNBO: "fnbo",
  "FIRST NATIONAL BANK OF OMAHA": "fnbo",
  PENFED: "penfed",
  COMENITY: "comenity",
  BILT: "bilt",
  WEB_BANK: "web-bank",
  "AMAZON.COM": "amazon",
  "AMERICAN AIRLINES": "american-airlines",
  DELTA: "delta",
  TILT: "tilt",
  FIRST: "first",
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[®™©'"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function proposeId(issuer: string, name: string): string {
  const key = issuer.toUpperCase();
  const iss =
    ISSUER_SLUG[key] ||
    ISSUER_SLUG[key.replace(/-/g, "_")] ||
    slugify(issuer);
  let n = name;
  const prefixes = [
    issuer,
    issuer.replace(/_/g, " "),
    "American Express",
    "Amex",
    "Chase",
    "Capital One",
    "Citi",
    "Wells Fargo",
    "Bank of America",
    "Discover",
    "U.S. Bank",
    "US Bank",
  ].sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (n.toLowerCase().startsWith(p.toLowerCase())) {
      n = n.slice(p.length).replace(/^[\s-]+/, "");
      break;
    }
  }
  n = n.replace(/\s+(credit\s+)?card$/i, "").trim();
  n = n.replace(/^the\s+/i, "");
  let card = slugify(n) || "card";
  if (!card.startsWith(iss + "-") && card !== iss) card = `${iss}-${card}`;
  return `us-${card}`;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[®™©'"]/g, "")
    .replace(/\b(credit\s+)?card\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function tokens(s: string): Set<string> {
  const stop = new Set([
    "card",
    "credit",
    "the",
    "from",
    "a",
    "an",
    "and",
    "rewards",
    "visa",
    "mastercard",
    "amex",
    "american",
    "express",
  ]);
  const out = new Set<string>();
  for (const t of s
    .toLowerCase()
    .replace(/[®™©'"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)) {
    if (t && !stop.has(t) && t.length > 1) out.add(t);
  }
  return out;
}

async function loadBonuses(): Promise<unknown[]> {
  const local = join(root, "clues/raw/credit-card-bonuses-api.json");
  if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8"));
  const url =
    "https://raw.githubusercontent.com/andenacitelli/credit-card-bonuses-api/main/exports/data.json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch bonuses API: ${res.status}`);
  return (await res.json()) as unknown[];
}

function loadCcdb(): unknown[] {
  const local = join(root, "clues/raw/credit-card-db-api.json");
  if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8"));
  try {
    const pkg = dirname(require.resolve("credit-card-db-api/package.json"));
    return JSON.parse(
      readFileSync(join(pkg, "credit_cards_data.json"), "utf8"),
    );
  } catch {
    const bundled = join("/tmp/ccdb/package/credit_cards_data.json");
    if (existsSync(bundled)) {
      return JSON.parse(readFileSync(bundled, "utf8"));
    }
    throw new Error(
      "credit-card-db-api data not found. Run: npm i credit-card-db-api --no-save, or place clues/raw/credit-card-db-api.json",
    );
  }
}

function loadExisting(): Record<string, { where: string; name: string }> {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const existing: Record<string, { where: string; name: string }> = {};
  for (const country of ["us", "ca", "cn"]) {
    const dir = join(root, "data", country);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const card = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        id: string;
        name?: string;
      };
      existing[card.id] = { where: "main", name: card.name ?? card.id };
    }
  }
  return existing;
}

async function main() {
  const bonuses = (await loadBonuses()) as Array<Record<string, unknown>>;
  const ccdb = loadCcdb() as Array<Record<string, unknown>>;

  type Raw = {
    clue_source: string;
    name: string;
    issuer: string;
    network: string | null;
    url: string | null;
    annual_fee: number | string | null;
    is_business: boolean;
    discontinued: boolean;
    image_url: string | null;
    proposed_id: string;
    norm: string;
    tokens: Set<string>;
  };

  const raws: Raw[] = [];
  for (const c of bonuses) {
    const imageUrl = c.imageUrl as string | undefined;
    raws.push({
      clue_source: "credit-card-bonuses-api",
      name: String(c.name),
      issuer: String(c.issuer),
      network: c.network != null ? String(c.network) : null,
      url: c.url != null ? String(c.url) : null,
      annual_fee: (c.annualFee as number | null) ?? null,
      is_business: Boolean(c.isBusiness),
      discontinued: Boolean(c.discontinued),
      image_url:
        imageUrl && imageUrl.startsWith("/")
          ? `https://offeroptimist.com${imageUrl}`
          : imageUrl ?? null,
      proposed_id: proposeId(String(c.issuer), String(c.name)),
      norm: norm(`${c.issuer} ${c.name}`),
      tokens: tokens(`${c.issuer} ${c.name}`),
    });
  }
  for (const c of ccdb) {
    raws.push({
      clue_source: "credit-card-db-api",
      name: String(c.name),
      issuer: String(c.issuer),
      network: c.network != null ? String(c.network) : null,
      url: c.application_url ? String(c.application_url) : null,
      annual_fee: (c.annual_fee as string | number | null) ?? null,
      is_business: false,
      discontinued: false,
      image_url: c.image_url ? String(c.image_url) : null,
      proposed_id: proposeId(String(c.issuer), String(c.name)),
      norm: norm(`${c.issuer} ${c.name}`),
      tokens: tokens(`${c.issuer} ${c.name}`),
    });
  }

  const byNorm = new Map<string, ClueCard & { _tokens: Set<string> }>();
  for (const r of raws) {
    const prev = byNorm.get(r.norm);
    if (!prev) {
      byNorm.set(r.norm, {
        clue_sources: [r.clue_source],
        name: r.name,
        issuer: r.issuer,
        network: r.network,
        url: r.url,
        annual_fee: r.annual_fee,
        is_business: r.is_business,
        discontinued: r.discontinued,
        image_url: r.image_url,
        proposed_id: r.proposed_id,
        country: "us",
        norm: r.norm,
        status_vs_repo: "missing",
        matched_id: null,
        matched_where: null,
        _tokens: r.tokens,
      });
    } else {
      prev.clue_sources = [...new Set([...prev.clue_sources, r.clue_source])].sort();
      if (!prev.url && r.url) prev.url = r.url;
      prev.is_business = prev.is_business || r.is_business;
      prev.discontinued = prev.discontinued || r.discontinued;
    }
  }

  const existing = loadExisting();
  const aliases: Record<string, string> = {
    "us-capital-one-venture-rewards": "us-capital-one-venture",
  };
  const existNorms = new Map<string, string>();
  const existTok = new Map<string, Set<string>>();
  for (const [id, meta] of Object.entries(existing)) {
    const n = norm(meta.name);
    if (n.length >= 8) existNorms.set(n, id);
    existTok.set(id, tokens(meta.name));
  }

  const union = [...byNorm.values()];
  for (const u of union) {
    if (!u.norm) {
      throw new Error(`missing norm for ${u.proposed_id} / ${u.name}`);
    }
    if (existing[u.proposed_id]) {
      u.status_vs_repo = "covered";
      u.matched_id = u.proposed_id;
      u.matched_where = existing[u.proposed_id].where;
      continue;
    }
    const alias = aliases[u.proposed_id];
    if (alias && existing[alias]) {
      u.status_vs_repo = "covered";
      u.matched_id = alias;
      u.matched_where = existing[alias].where;
      continue;
    }
    if (u.norm.length >= 8 && existNorms.has(u.norm)) {
      const mid = existNorms.get(u.norm)!;
      u.status_vs_repo = "covered";
      u.matched_id = mid;
      u.matched_where = existing[mid].where;
      continue;
    }
    let best: string | null = null;
    let bestJ = 0;
    const ut = u._tokens ?? new Set<string>();
    for (const [eid, et] of existTok) {
      if (!et.size || !ut.size) continue;
      const inter = [...ut].filter((t) => et.has(t)).length;
      const uni = new Set([...ut, ...et]).size;
      const j = inter / uni;
      if (j > bestJ) {
        bestJ = j;
        best = eid;
      }
    }
    if (best && bestJ >= 0.75) {
      u.status_vs_repo = "likely_covered";
      u.matched_id = best;
      u.matched_where = existing[best].where;
    } else {
      u.status_vs_repo = "missing";
    }
  }

  const cards = union
    .map(({ _tokens, ...rest }) => rest)
    .sort((a, b) => a.proposed_id.localeCompare(b.proposed_id));

  const missing = cards.filter((c) => c.status_vs_repo === "missing");
  const stats = {
    generated_at: new Date().toISOString().slice(0, 10),
    bonuses: bonuses.length,
    ccdb: ccdb.length,
    union_unique: cards.length,
    overlap_both_clues: cards.filter((c) => c.clue_sources.length === 2).length,
    in_repo_main: Object.keys(existing).length,
    covered: cards.filter((c) => c.status_vs_repo === "covered").length,
    likely_covered: cards.filter((c) => c.status_vs_repo === "likely_covered")
      .length,
    missing: missing.length,
    missing_active_consumer: missing.filter(
      (c) => !c.discontinued && !c.is_business,
    ).length,
    missing_active_business: missing.filter(
      (c) => !c.discontinued && c.is_business,
    ).length,
  };

  mkdirSync(join(root, "clues"), { recursive: true });
  const out = {
    note: "Third-party discovery clues only. Never use these URLs as Card sources unless they are official issuer/network pages. Always re-verify on the issuer site before merging.",
    stats,
    cards,
  };
  writeFileSync(join(root, "clues/wishlist.json"), JSON.stringify(out, null, 2) + "\n");
  writeFileSync(
    join(root, "clues/missing-active-consumer.json"),
    JSON.stringify(
      {
        note: out.note,
        generated_at: stats.generated_at,
        count: stats.missing_active_consumer,
        cards: missing.filter((c) => !c.discontinued && !c.is_business),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(stats, null, 2));
  console.log("Wrote clues/wishlist.json and clues/missing-active-consumer.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
