#!/usr/bin/env node
/**
 * CLI: read PR title/body/files from env or argv and print triage JSON.
 * Env: PR_TITLE, PR_BODY, PR_FILES (newline-separated)
 */
import { triagePullRequest } from "./pr-triage.ts";

const title = process.env.PR_TITLE ?? process.argv[2] ?? "";
const body = process.env.PR_BODY ?? "";
const filesRaw = process.env.PR_FILES ?? "";
const changedFiles = filesRaw
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const result = triagePullRequest({ title, body, changedFiles });
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
if (!result.titleOk || result.missing.length > 0) {
  process.exitCode = 1;
}
