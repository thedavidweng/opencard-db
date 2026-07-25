#!/usr/bin/env node
/**
 * CLI: read PR title/body/files from env and print triage JSON.
 *
 * Env:
 *   PR_TITLE, PR_BODY, PR_FILES (newline-separated)
 *   PR_TRIAGE_MODE = labels | check | all (default: all)
 *   PR_NUMBER — current PR (exclude from duplicate search)
 *   PR_AUTHOR — pinged in Form check comments
 *   OPEN_CARD_PRS_JSON — JSON array of {number,title,url,author?}
 *   BASE_CARDS_JSON — JSON map path → {path,exists,last_verified}
 *
 * Exit: labels → always 0; check/all → 1 when form has errors
 */
import { triagePullRequest, type BaseCardSnapshot, type OpenPrHint } from "./pr-triage.ts";

const title = process.env.PR_TITLE ?? process.argv[2] ?? "";
const body = process.env.PR_BODY ?? "";
const filesRaw = process.env.PR_FILES ?? "";
const mode = (process.env.PR_TRIAGE_MODE ?? "all").toLowerCase();
const changedFiles = filesRaw
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

function parseJsonEnv<T>(raw: string | undefined, fallback: T): T {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error("warning: failed to parse JSON env; using fallback");
    return fallback;
  }
}

const currentPrNumber = process.env.PR_NUMBER
  ? Number(process.env.PR_NUMBER)
  : undefined;

const openCardPrs = parseJsonEnv<OpenPrHint[]>(
  process.env.OPEN_CARD_PRS_JSON,
  [],
);
const baseCards = parseJsonEnv<Record<string, BaseCardSnapshot>>(
  process.env.BASE_CARDS_JSON,
  {},
);

const result = triagePullRequest({
  title,
  body,
  changedFiles,
  currentPrNumber: Number.isFinite(currentPrNumber) ? currentPrNumber : undefined,
  openCardPrs,
  baseCards,
});
process.stdout.write(JSON.stringify(result, null, 2) + "\n");

const hasErrors =
  !result.titleOk ||
  result.issues.some((i) => i.severity === "error") ||
  result.missing.length > 0;

if (mode === "labels") {
  process.exitCode = 0;
} else if (hasErrors) {
  process.exitCode = 1;
}
