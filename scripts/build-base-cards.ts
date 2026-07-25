#!/usr/bin/env node
/**
 * Build BASE_CARDS_JSON for the Form check. For each data/*.json path in
 * PR_FILES, snapshot the card as it exists on the PR **base** commit and (when
 * available) the PR **head** commit, so triage can:
 *   - decide add vs update and compare last_verified (base version), and
 *   - diff/flag high-impact key-field changes (base → head, anti-vandalism).
 *
 * Env: PR_FILES, BASE_SHA, HEAD_SHA (optional)
 * Prints JSON (path → BaseCardSnapshot) to stdout.
 *
 * Trust model: this only READS git blobs (`git show <sha>:<path>`) and parses
 * them as data — it never checks out or runs PR-authored code. The head blob is
 * treated exactly like the (untrusted) PR title/body: read, parsed, compared.
 * The blob-reading side effects live in main(); the field extraction is pure
 * and exported for unit tests.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { BaseCardSnapshot, CardKeyFields } from "./pr-triage.ts";

const CARD_PATH_RE = /^data\/[a-z]{2}\/[a-z0-9-]+\.json$/;

function asNumber(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Extract the watched key fields from a raw card JSON blob. Pure — returns null
 * when the blob is absent or not valid JSON.
 */
export function extractKeyFields(raw: string | null): CardKeyFields | null {
  if (raw == null) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const annualFee = json.annual_fee as { amount?: unknown } | undefined;
  const fxFee = json.fx_fee as { percent?: unknown } | undefined;
  const rewards = json.rewards as
    | { base_rate?: { points_per_dollar?: unknown } }
    | undefined;
  return {
    name: asString(json.name),
    issuer_id: asString(json.issuer_id),
    network: asString(json.network),
    network_tier: asString(json.network_tier),
    annual_fee_amount: asNumber(annualFee?.amount),
    fx_fee_percent: asNumber(fxFee?.percent),
    base_rate_points_per_dollar: asNumber(
      rewards?.base_rate?.points_per_dollar,
    ),
    official_url: asString(json.official_url),
    status: asString(json.status),
    segment: asString(json.segment),
  };
}

function lastVerifiedOf(raw: string | null): string | null {
  const fields = raw == null ? null : safeParse(raw);
  const lv = fields?.last_verified;
  return typeof lv === "string" ? lv : null;
}
function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Build the base/head snapshot for each card path. `readBlob(sha, path)`
 * returns the file contents at that commit, or null when it does not exist.
 * Pure given `readBlob`, so tests can inject a fake reader.
 */
export function buildSnapshots(
  files: string[],
  baseSha: string,
  headSha: string,
  readBlob: (sha: string, path: string) => string | null,
): Record<string, BaseCardSnapshot> {
  const out: Record<string, BaseCardSnapshot> = {};
  for (const p of files) {
    const baseRaw = baseSha ? readBlob(baseSha, p) : null;
    const headRaw = headSha ? readBlob(headSha, p) : null;
    out[p] = {
      path: p,
      exists: baseRaw != null,
      last_verified: lastVerifiedOf(baseRaw),
      base: extractKeyFields(baseRaw),
      head: extractKeyFields(headRaw),
    };
  }
  return out;
}

function gitShow(sha: string, filePath: string): string | null {
  try {
    return execFileSync("git", ["show", `${sha}:${filePath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function main(): void {
  const baseSha = process.env.BASE_SHA ?? "";
  const headSha = process.env.HEAD_SHA ?? "";
  const files = (process.env.PR_FILES ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((f) => CARD_PATH_RE.test(f));
  const out = buildSnapshots(files, baseSha, headSha, gitShow);
  process.stdout.write(JSON.stringify(out));
}

const isDirectRun =
  process.argv[1] != null &&
  import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) {
  main();
}
