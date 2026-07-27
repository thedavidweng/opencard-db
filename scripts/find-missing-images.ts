#!/usr/bin/env node
/**
 * Find cards that have no card-face image (`image.url` is null, missing, or
 * the `image` object itself is absent). Group by issuer and print a JSON
 * report to stdout so the `missing-images` workflow can render it into a
 * tracking issue.
 *
 *   {
 *     generated_at: "2026-07-26T…Z",
 *     total_missing: 42,
 *     issuers: [
 *       {
 *         issuer_id: "amex",
 *         issuer_name: "American Express",
 *         cards: [
 *           { id, name, file, status, official_url }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Cards with a `local_path` mirror (Apple Pay / upload) are NOT missing —
 * only cards where neither `image.url` nor `image.local_path` is set count.
 *
 * Env: none. Pure read of data/ + data/issuers.json.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadAllCards, repoRoot, type Card } from "./lib.ts";

type IssuerEntry = {
  issuer_id: string;
  issuer_name: string;
  cards: Array<{
    id: string;
    name: string;
    file: string;
    status: string;
    official_url: string | null;
  }>;
};

type MissingImageReport = {
  generated_at: string;
  total_missing: number;
  issuers: IssuerEntry[];
};

type Image = {
  url?: string | null;
  local_path?: string | null;
  attribution?: string | null;
} | null;

function hasImage(card: Card): boolean {
  const image = (card as { image?: Image }).image;
  if (!image) return false;
  if (typeof image !== "object") return false;
  if (image.url && String(image.url).trim()) return true;
  if (image.local_path && String(image.local_path).trim()) return true;
  return false;
}

async function loadIssuerNames(): Promise<Map<string, string>> {
  const raw = await readFile(
    path.join(repoRoot(), "data", "issuers.json"),
    "utf8",
  );
  const data = JSON.parse(raw) as {
    issuers: Array<{ id: string; name: string }>;
  };
  const map = new Map<string, string>();
  for (const i of data.issuers) map.set(i.id, i.name);
  return map;
}

function repoRelative(file: string): string {
  const root = repoRoot();
  const rel = path.relative(root, file);
  return rel.split(path.sep).join("/");
}

export async function findMissingImageCards(): Promise<MissingImageReport> {
  const all = await loadAllCards();
  const issuerNames = await loadIssuerNames();

  const byIssuer = new Map<string, IssuerEntry>();
  let total = 0;

  for (const { file, card } of all) {
    if (hasImage(card)) continue;
    const issuerId = card.issuer_id || "unknown";
    if (!byIssuer.has(issuerId)) {
      byIssuer.set(issuerId, {
        issuer_id: issuerId,
        issuer_name: issuerNames.get(issuerId) ?? issuerId,
        cards: [],
      });
    }
    byIssuer.get(issuerId)!.cards.push({
      id: card.id,
      name: card.name,
      file: repoRelative(file),
      status: card.status || "active",
      official_url:
        (card as { official_url?: string | null }).official_url ?? null,
    });
    total++;
  }

  const issuers = [...byIssuer.values()].sort((a, b) => {
    // Most missing cards first, then alphabetical by issuer name.
    if (b.cards.length !== a.cards.length) {
      return b.cards.length - a.cards.length;
    }
    return a.issuer_name.localeCompare(b.issuer_name);
  });

  // Sort cards within each issuer: active first, then by id.
  for (const i of issuers) {
    i.cards.sort((a, b) => {
      const aActive = a.status === "active" || a.status === "invite_only";
      const bActive = b.status === "active" || b.status === "invite_only";
      if (aActive !== bActive) return aActive ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  }

  return {
    generated_at: new Date().toISOString(),
    total_missing: total,
    issuers,
  };
}

async function main(): Promise<void> {
  const report = await findMissingImageCards();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
