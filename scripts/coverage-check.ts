#!/usr/bin/env node
/**
 * Coverage check against public card lists — REFERENCE ONLY.
 *
 * Fetches two third-party card lists at runtime and reports which of their
 * active cards OpenCard DB does not cover yet. Nothing from these sources is
 * ever written to the repo: they are discovery references, never `sources`
 * (see issue #26). Every OpenCard DB record is independently verified against
 * official issuer/network pages.
 *
 * Usage: npm run coverage:check [-- --strict]   (--strict: exit 1 on gaps)
 */
import { loadAllCards } from "./lib.ts";

const UPSTREAMS = [
  {
    key: "bonuses",
    url: "https://raw.githubusercontent.com/andenacitelli/credit-card-bonuses-api/main/exports/data.json",
    extract: (raw: unknown) =>
      (raw as { name?: string; issuer?: string; discontinued?: boolean; isBusiness?: boolean }[])
        .filter((c) => !c.discontinued)
        .map((c) => ({
          name: c.name ?? "",
          issuer: (c.issuer ?? "").replace(/_/g, " "),
          business: Boolean(c.isBusiness),
        })),
  },
  {
    key: "ccdb",
    url: "https://cdn.jsdelivr.net/npm/credit-card-db-api@1.0.0/credit_cards_data.json",
    extract: (raw: unknown) =>
      (raw as { card_name?: string; name?: string; issuer?: string; bank?: string }[]).map(
        (c) => ({
          name: c.card_name ?? c.name ?? "",
          issuer: c.issuer ?? c.bank ?? "",
          business: false,
        }),
      ),
  },
];

const STOPWORDS = new Set(["the", "card", "credit", "from", "by", "a", "an", "of", "cards"]);

export function normName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9一-鿿 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .join(" ");
}

const ISSUER_ALIAS: Record<string, string> = {
  "american express": "amex",
  "bank of america": "bank-of-america",
  "capital one": "capital-one",
  "us bank": "us-bank",
  "u.s. bank": "us-bank",
  "wells fargo": "wells-fargo",
  "first national bank of omaha": "fnbo",
  "goldman sachs": "goldman-sachs",
  "jpmorgan chase": "chase",
  citibank: "citi",
};

export function normIssuer(s: string): string {
  const n = (s || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[^a-z. ]+/g, "")
    .trim();
  return ISSUER_ALIAS[n] ?? n.replace(/\./g, "").replace(/ +/g, "-");
}

export type LocalCard = { id: string; nameTokens: Set<string>; issuerId: string };

export function isCovered(
  name: string,
  issuer: string,
  locals: LocalCard[],
): { covered: boolean; nearest: string | null; score: number } {
  const nn = new Set(normName(name).split(" ").filter(Boolean));
  const ii = normIssuer(issuer);
  let best = 0;
  let nearest: string | null = null;
  for (const o of locals) {
    const on = new Set([...o.nameTokens, ...o.id.split("-")]);
    if (nn.size === 0 || on.size === 0) continue;
    const issuerOk =
      Boolean(ii) &&
      (ii === o.issuerId || ii.includes(o.issuerId) || o.issuerId.includes(ii) || o.id.includes(ii));
    const inter = [...nn].filter((t) => on.has(t)).length;
    const union = new Set([...nn, ...on]).size;
    const jaccard = union ? inter / union : 0;
    const contains = [...nn].every((t) => on.has(t));
    const score = contains && issuerOk ? 1 : jaccard + (issuerOk ? 0.2 : 0);
    if (score > best) {
      best = score;
      nearest = o.id;
    }
  }
  return { covered: best >= 0.62, nearest, score: Math.round(best * 100) / 100 };
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");
  const loaded = await loadAllCards();
  const locals: LocalCard[] = loaded.map(({ card }) => ({
    id: card.id,
    nameTokens: new Set(normName(card.name).split(" ").filter(Boolean)),
    issuerId: card.issuer_id,
  }));

  let total = 0;
  const gaps: { source: string; name: string; issuer: string; nearest: string | null; score: number }[] = [];
  const seen = new Set<string>();

  for (const up of UPSTREAMS) {
    let raw: unknown;
    try {
      const res = await fetch(up.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      console.warn(`warning: could not fetch ${up.key} (${String(err)}); skipping`);
      continue;
    }
    for (const c of up.extract(raw)) {
      const key = `${normIssuer(c.issuer)}|${normName(c.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += 1;
      const r = isCovered(c.name, c.issuer, locals);
      if (!r.covered) gaps.push({ source: up.key, ...c, nearest: r.nearest, score: r.score });
    }
  }

  console.log(`coverage: ${total - gaps.length}/${total} upstream-known active cards covered (${loaded.length} cards in DB)`);
  if (gaps.length) {
    console.log("\nnot covered (verify against OFFICIAL pages before adding — never copy upstream data):");
    for (const g of gaps) {
      console.log(`  - [${g.source}] ${g.name} (${g.issuer})  nearest=${g.nearest ?? "-"} score=${g.score}`);
    }
  }
  if (strict && gaps.length) process.exit(1);
}

const isDirectRun =
  process.argv[1] != null && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
