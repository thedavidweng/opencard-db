#!/usr/bin/env node
/**
 * Build BASE_CARDS_JSON for Form check: for each data/*.json path in PR_FILES,
 * read last_verified from the PR base commit (if the file existed).
 *
 * Env: PR_FILES, BASE_SHA
 * Prints JSON to stdout.
 */
import { execFileSync } from "node:child_process";
import type { BaseCardSnapshot } from "./pr-triage.ts";

const baseSha = process.env.BASE_SHA ?? "";
const files = (process.env.PR_FILES ?? "")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter((f) => /^data\/[a-z]{2}\/[a-z0-9-]+\.json$/.test(f));

const out: Record<string, BaseCardSnapshot> = {};

for (const path of files) {
  if (!baseSha) {
    out[path] = { path, exists: false, last_verified: null };
    continue;
  }
  try {
    const raw = execFileSync("git", ["show", `${baseSha}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let last_verified: string | null = null;
    try {
      const json = JSON.parse(raw) as { last_verified?: unknown };
      if (typeof json.last_verified === "string") {
        last_verified = json.last_verified;
      }
    } catch {
      last_verified = null;
    }
    out[path] = { path, exists: true, last_verified };
  } catch {
    out[path] = { path, exists: false, last_verified: null };
  }
}

process.stdout.write(JSON.stringify(out));
