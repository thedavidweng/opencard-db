#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAllCards, repoRoot, type Card } from "./lib.ts";

export type IndexArtifacts = {
  meta: {
    schema_version: string;
    card_count: number;
    countries: string[];
    generated_at: string;
  };
  "cards:all": Card[];
  "cards:by-id": Record<string, Card>;
  "index:country": Record<string, string[]>;
  "index:issuer": Record<string, string[]>;
  "index:network": Record<string, string[]>;
  "index:network_tier": Record<string, string[]>;
};

function pushIndex(
  map: Record<string, string[]>,
  key: string,
  id: string,
): void {
  if (!map[key]) map[key] = [];
  map[key].push(id);
}

export async function buildIndexArtifacts(): Promise<IndexArtifacts> {
  const loaded = await loadAllCards();
  const cards = loaded.map((x) => x.card).sort((a, b) => a.id.localeCompare(b.id));

  const byId: Record<string, Card> = {};
  const byCountry: Record<string, string[]> = {};
  const byIssuer: Record<string, string[]> = {};
  const byNetwork: Record<string, string[]> = {};
  const byTier: Record<string, string[]> = {};
  const countries = new Set<string>();

  for (const card of cards) {
    byId[card.id] = card;
    countries.add(card.country);
    pushIndex(byCountry, card.country, card.id);
    pushIndex(byIssuer, card.issuer_id, card.id);
    pushIndex(byNetwork, card.network, card.id);
    pushIndex(byTier, card.network_tier, card.id);
  }

  for (const map of [byCountry, byIssuer, byNetwork, byTier]) {
    for (const key of Object.keys(map)) {
      map[key].sort();
    }
  }

  return {
    meta: {
      schema_version: "1.0.0",
      card_count: cards.length,
      countries: [...countries].sort(),
      generated_at: new Date().toISOString(),
    },
    "cards:all": cards,
    "cards:by-id": byId,
    "index:country": byCountry,
    "index:issuer": byIssuer,
    "index:network": byNetwork,
    "index:network_tier": byTier,
  };
}

async function main(): Promise<void> {
  const artifacts = await buildIndexArtifacts();
  const outDir = path.join(repoRoot(), "dist", "indexes");
  await mkdir(outDir, { recursive: true });

  const writes: [string, unknown][] = [
    ["meta.json", artifacts.meta],
    ["cards-all.json", artifacts["cards:all"]],
    ["cards-by-id.json", artifacts["cards:by-id"]],
    ["index-country.json", artifacts["index:country"]],
    ["index-issuer.json", artifacts["index:issuer"]],
    ["index-network.json", artifacts["index:network"]],
    ["index-network-tier.json", artifacts["index:network_tier"]],
  ];

  for (const [name, value] of writes) {
    await writeFile(
      path.join(outDir, name),
      JSON.stringify(value, null, 2) + "\n",
      "utf8",
    );
  }

  console.log(
    `ok: wrote ${writes.length} index files (${artifacts.meta.card_count} cards) → dist/indexes/`,
  );
}

// Run when executed as CLI; when imported by tests, only export buildIndexArtifacts.
const entry = process.argv[1] ?? "";
if (entry.includes("build-indexes")) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
