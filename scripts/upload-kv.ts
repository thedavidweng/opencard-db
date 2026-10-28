#!/usr/bin/env node
/**
 * Upload pre-built index artifacts (dist/indexes, from `bun run build:indexes`)
 * to the production Cloudflare KV namespace via the worker's pinned cf CLI.
 *
 * The namespace id and account id come from production mode in
 * worker/cloudflare.config.ts. KV_NAMESPACE_ID overrides the namespace id
 * for self-hosters. Auth: CLOUDFLARE_API_TOKEN in CI, or a local `cf auth login`
 * session. CLOUDFLARE_ACCOUNT_ID overrides the account id from the config.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
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

type ProductionIds = {
  accountId: string;
  kvId: string;
};

function productionIds(): ProductionIds {
  const workerDir = path.join(repoRoot(), "worker");
  const result = spawnSync(
    "bun",
    [
      "-e",
      [
        'import config from "./cloudflare.config.ts";',
        'const resolved = await config({ mode: "production", isPreview: false });',
        "const kv = resolved.worker?.env?.OPENCARD_KV;",
        'if (!kv || kv.type !== "kv" || typeof kv.id !== "string" || kv.id.length === 0) {',
        '  throw new Error("production mode has no OPENCARD_KV id in cloudflare.config.ts");',
        "}",
        "if (typeof resolved.accountId !== \"string\" || resolved.accountId.length === 0) {",
        '  throw new Error("production mode has no accountId in cloudflare.config.ts");',
        "}",
        "console.log(JSON.stringify({ accountId: resolved.accountId, kvId: kv.id }));",
      ].join("\n"),
    ],
    { cwd: workerDir, encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout) as ProductionIds;
}

function main(): void {
  const production = productionIds();
  const ns = process.env.KV_NAMESPACE_ID || production.kvId;
  const env = { ...process.env };
  if (!env.CLOUDFLARE_ACCOUNT_ID) {
    env.CLOUDFLARE_ACCOUNT_ID = production.accountId;
  }
  const indexDir = path.join(repoRoot(), "dist", "indexes");
  const cf = path.join(repoRoot(), "worker", "node_modules", ".bin", "cf");

  for (const [key, file] of pairs) {
    const filePath = path.join(indexDir, file);
    console.log(`Putting ${key} from ${file}...`);
    const result = spawnSync(
      cf,
      [
        "kv",
        "keys",
        "put",
        key,
        "--file",
        filePath,
        "--namespace-id",
        ns,
      ],
      { stdio: "inherit", env, cwd: path.join(repoRoot(), "worker") },
    );
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
  console.log("ok: uploaded KV keys");
}

main();
