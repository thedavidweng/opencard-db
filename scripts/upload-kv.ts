#!/usr/bin/env node
/**
 * Upload pre-built index artifacts to Cloudflare KV via wrangler CLI.
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./lib.ts";

const pairs: [string, string][] = [
  ["meta", "meta.json"],
  ["cards:all", "cards-all.json"],
  ["cards:by-id", "cards-by-id.json"],
  ["index:country", "index-country.json"],
  ["index:issuer", "index-issuer.json"],
  ["index:network", "index-network.json"],
  ["index:network_tier", "index-network-tier.json"],
];

function main(): void {
  const ns = process.env.KV_NAMESPACE_ID;
  if (!ns) {
    console.error("KV_NAMESPACE_ID is required");
    process.exit(1);
  }
  const indexDir = path.join(repoRoot(), "dist", "indexes");

  for (const [key, file] of pairs) {
    const filePath = path.join(indexDir, file);
    console.log(`Putting ${key} from ${file}...`);
    const result = spawnSync(
      "wrangler",
      [
        "kv",
        "key",
        "put",
        key,
        "--path",
        filePath,
        "--namespace-id",
        ns,
        "--remote",
      ],
      { stdio: "inherit", env: process.env },
    );
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
  console.log("ok: uploaded KV keys");
}

main();
