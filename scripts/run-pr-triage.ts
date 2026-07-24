#!/usr/bin/env node
/**
 * CLI: read PR title/body/files from env and print triage JSON.
 *
 * Env:
 *   PR_TITLE, PR_BODY, PR_FILES (newline-separated)
 *   PR_TRIAGE_MODE = labels | check | all (default: all)
 *
 * Exit codes:
 *   labels → always 0 (classification only)
 *   check  → 1 when title/form incomplete
 *   all    → 1 when title/form incomplete
 */
import { triagePullRequest } from "./pr-triage.ts";

const title = process.env.PR_TITLE ?? process.argv[2] ?? "";
const body = process.env.PR_BODY ?? "";
const filesRaw = process.env.PR_FILES ?? "";
const mode = (process.env.PR_TRIAGE_MODE ?? "all").toLowerCase();
const changedFiles = filesRaw
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const result = triagePullRequest({ title, body, changedFiles });
process.stdout.write(JSON.stringify(result, null, 2) + "\n");

if (mode === "labels") {
  process.exitCode = 0;
} else if (!result.titleOk || result.missing.length > 0) {
  process.exitCode = 1;
}
