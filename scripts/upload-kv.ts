#!/usr/bin/env node
/**
 * Upload pre-built index artifacts (dist/indexes, from `npm run build:indexes`)
 * to the production Cloudflare KV namespace via the worker's pinned wrangler.
 *
 * The namespace id comes from worker/wrangler.jsonc (env.production), the
 * single source of truth; KV_NAMESPACE_ID overrides it for self-hosters.
 * Auth: CLOUDFLARE_API_TOKEN in CI, or a local `wrangler login` session.
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

/** Strip // and /* comments so wrangler.jsonc parses as JSON. */
function parseJsonc(text: string): unknown {
  const noComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(noComments);
}

async function productionNamespaceId(): Promise<string | null> {
  try {
    const raw = await readFile(
      path.join(repoRoot(), "worker", "wrangler.jsonc"),
      "utf-8",
    );
    const config = parseJsonc(raw) as {
      env?: {
        production?: { kv_namespaces?: Array<{ binding: string; id: string }> };
      };
    };
    const ns = config.env?.production?.kv_namespaces?.find(
      (n) => n.binding === "OPENCARD_KV",
    );
    return ns?.id ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const ns = process.env.KV_NAMESPACE_ID || (await productionNamespaceId());
  if (!ns) {
    console.error(
      "No KV namespace id: set KV_NAMESPACE_ID or define env.production in worker/wrangler.jsonc",
    );
    process.exit(1);
  }
  const indexDir = path.join(repoRoot(), "dist", "indexes");

  for (const [key, file] of pairs) {
    const filePath = path.join(indexDir, file);
    console.log(`Putting ${key} from ${file}...`);
    const result = spawnSync(
      "npx",
      [
        "wrangler",
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
      // cwd worker/ resolves the pinned wrangler from worker/node_modules.
      { stdio: "inherit", env: process.env, cwd: path.join(repoRoot(), "worker") },
    );
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
  console.log("ok: uploaded KV keys");
}

await main();
