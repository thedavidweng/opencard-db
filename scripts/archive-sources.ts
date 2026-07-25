#!/usr/bin/env node
/**
 * Proactively archive every card's evidence URLs to the Internet Archive via
 * the Wayback "Save Page Now" endpoint, so that when a bank later takes an
 * official page down we can swap the source to a `web.archive.org/web/<ts>/…`
 * snapshot that already exists (the validator unwraps and accepts those).
 *
 * Modes (args or env):
 *   (default)                      — archive URLs from every card in data/.
 *   --changed <file> [<file> …]    — only URLs from the given card files
 *                                    (also reads CHANGED_FILES, whitespace-
 *                                    separated); used at merge time so a new /
 *                                    updated card's evidence is captured now.
 *   --batch N --offset-key <key>   — weekly rotation: take a deterministic
 *                                    slice of N URLs, offset by the ISO week
 *                                    derived from <key> (an ISO date string),
 *                                    so the whole set rotates over the weeks.
 *
 * Etiquette (Wayback asks for this): requests are sequential — never parallel —
 * with a ~4s gap, every failure is non-fatal (logged, then we continue), and
 * the whole run stops gracefully after an ~8 minute budget. Anonymous SPN is
 * fine at this volume, so there are no API keys and no new dependencies.
 *
 * The parts that decide *what* to archive (`collectArchivableUrls`,
 * `isWaybackUrl`, `filterCardFiles`, `isoWeekNumber`, `selectBatch`,
 * `parseArgs`, `buildSaveUrl`) are pure and unit-tested without any network.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadAllCards, repoRoot } from "./lib.ts";

const REPO_URL = "https://github.com/thedavidweng/opencard-db";
export const USER_AGENT = `opencard-db-archiver/1.0 (+${REPO_URL})`;

/** ~4s between Save Page Now calls — Wayback etiquette, no parallelism. */
export const DELAY_MS = 4000;
/** Stop starting new saves after this wall-clock budget. */
export const TIME_BUDGET_MS = 8 * 60 * 1000;
/** Per-request ceiling; SPN can be slow but should not hang the whole run. */
export const REQUEST_TIMEOUT_MS = 45000;
/** Default rotation batch size. */
export const DEFAULT_BATCH = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The only card fields this script reads; the index signature keeps full
 * `Card` objects assignable (avoids TS weak-type detection). */
export type CardLike = {
  official_url?: unknown;
  sources?: unknown;
  [key: string]: unknown;
};

export type ArchiveMode = "all" | "changed" | "batch";

export type ArchiveConfig = {
  mode: ArchiveMode;
  changedFiles: string[];
  batch: number;
  offsetKey: string;
};

/**
 * True if `url` already points at an Internet Archive snapshot (web.archive.org
 * or archive.org). Such URLs are the archive itself, so we never re-archive
 * them. Non-URL / non-http input is treated as "not an archive URL".
 */
export function isWaybackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "web.archive.org" ||
    host === "archive.org" ||
    host.endsWith(".archive.org")
  );
}

/**
 * Pure: collect the de-duplicated, sorted set of http(s) URLs worth archiving
 * from a list of cards — each card's `official_url` plus every entry of its
 * `sources[]`. URLs already on the Wayback Machine, non-strings, blanks, and
 * non-http(s) schemes are skipped.
 */
export function collectArchivableUrls(
  cards: CardLike[],
): string[] {
  const set = new Set<string>();
  for (const card of cards) {
    const candidates: unknown[] = [];
    if (typeof card.official_url === "string") candidates.push(card.official_url);
    if (Array.isArray(card.sources)) candidates.push(...card.sources);
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const url = candidate.trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) continue;
      if (isWaybackUrl(url)) continue;
      set.add(url);
    }
  }
  return [...set].sort();
}

/**
 * Pure: keep only real card files — repo-relative `data/<country>/<slug>.json`
 * paths — from an arbitrary changed-file list, de-duplicated and order-
 * preserving. This drops the top-level registries (`data/issuers.json`,
 * `data/network-tiers.json`), anything outside `data/`, and hidden dirs.
 */
export function filterCardFiles(files: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of files) {
    const file = raw.trim().replace(/^\.\//, "");
    if (!file) continue;
    const match = /^data\/([^/.][^/]*)\/([^/]+)\.json$/.exec(file);
    if (!match) continue;
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

/**
 * Pure: ISO-8601 week number (1–53) of `date`, computed in UTC so it never
 * drifts with the runner's timezone. Weeks start Monday; week 1 contains the
 * first Thursday of the year.
 */
export function isoWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // to the Thursday of this week
  const firstThursday = Date.UTC(d.getUTCFullYear(), 0, 4);
  const firstDayNum = (new Date(firstThursday).getUTCDay() + 6) % 7;
  const week1Thursday = firstThursday + (3 - firstDayNum) * DAY_MS;
  return 1 + Math.round((d.getTime() - week1Thursday) / (7 * DAY_MS));
}

/**
 * Pure: the ISO week number implied by an offset key. The key is expected to be
 * a date string (`YYYY-MM-DD` or anything `Date`-parseable); an unparseable key
 * falls back to week 0 so the rotation is still deterministic.
 */
export function weekIndexFromKey(offsetKey: string): number {
  const key = offsetKey.trim();
  if (!key) return 0;
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(key)
    ? Date.parse(`${key}T00:00:00Z`)
    : Date.parse(key);
  if (Number.isNaN(ms)) return 0;
  return isoWeekNumber(new Date(ms));
}

/**
 * Pure: pick a deterministic slice of `batch` URLs from the (re-sorted) set,
 * starting at an offset derived from the ISO week of `offsetKey` and wrapping
 * around. Consecutive weeks advance the window by `batch`, so the whole set is
 * covered over ⌈total/batch⌉ weeks. Returns the whole set when `batch` ≥ total
 * or `batch` ≤ 0.
 */
export function selectBatch(
  urls: string[],
  batch: number,
  offsetKey: string,
): string[] {
  const sorted = [...urls].sort();
  const total = sorted.length;
  if (total === 0) return [];
  if (!Number.isFinite(batch) || batch <= 0 || batch >= total) return sorted;
  const week = weekIndexFromKey(offsetKey);
  const start = ((week * batch) % total + total) % total;
  const out: string[] = [];
  for (let i = 0; i < batch; i++) out.push(sorted[(start + i) % total]);
  return out;
}

/** Pure: the Save Page Now URL for a target — the original URL is appended raw. */
export function buildSaveUrl(url: string): string {
  return `https://web.archive.org/save/${url}`;
}

/**
 * Pure: turn argv (the slice after `node script.ts`) plus env into a config.
 * `--changed` collects the following non-flag args as files and also folds in
 * whitespace-separated `CHANGED_FILES`. `--batch` / `--offset-key` (or env
 * `ARCHIVE_BATCH` / `OFFSET_KEY`) select rotation mode.
 */
export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = {},
): ArchiveConfig {
  const changedFiles: string[] = [];
  let mode: ArchiveMode = "all";
  let batch = DEFAULT_BATCH;
  let offsetKey = env.OFFSET_KEY?.trim() ?? "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--changed") {
      mode = "changed";
      // Consume following args until the next flag as file paths.
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        changedFiles.push(argv[++i]);
      }
    } else if (arg === "--batch") {
      mode = "batch";
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        batch = Number(next);
        i++;
      }
    } else if (arg.startsWith("--batch=")) {
      mode = "batch";
      batch = Number(arg.slice("--batch=".length));
    } else if (arg === "--offset-key") {
      const next = argv[i + 1];
      if (next !== undefined) {
        offsetKey = next;
        i++;
      }
    } else if (arg.startsWith("--offset-key=")) {
      offsetKey = arg.slice("--offset-key=".length);
    }
  }

  const envChanged = env.CHANGED_FILES?.trim();
  if (envChanged) {
    for (const f of envChanged.split(/\s+/)) if (f) changedFiles.push(f);
    if (mode === "all") mode = "changed";
  }

  if (mode === "batch") {
    const envBatch = env.ARCHIVE_BATCH?.trim();
    if (envBatch && !Number.isNaN(Number(envBatch))) batch = Number(envBatch);
  }

  return { mode, changedFiles: filterCardFiles(changedFiles), batch, offsetKey };
}

export type SaveResult = { ok: boolean; status: number; error?: string };

/**
 * Fire one Save Page Now request. Never throws — any transport error or slow
 * response resolves to `{ ok: false }` so the caller keeps going.
 */
async function savePageNow(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const res = await fetchImpl(buildSaveUrl(url), {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { ok: res.status < 400, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error)?.message ?? String(err) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Load the given repo-relative card files, skipping any that can't be read. */
async function loadChangedCards(
  files: string[],
): Promise<{ official_url?: unknown; sources?: unknown }[]> {
  const root = repoRoot();
  const cards: CardLike[] = [];
  for (const rel of files) {
    try {
      const raw = await readFile(path.join(root, rel), "utf8");
      cards.push(JSON.parse(raw));
    } catch (err) {
      console.warn(`skip unreadable card file ${rel}: ${(err as Error).message}`);
    }
  }
  return cards;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2), process.env);

  let cards: CardLike[];
  if (config.mode === "changed") {
    if (config.changedFiles.length === 0) {
      console.log(
        "archive-sources: no card files in changed set — nothing to do.",
      );
      return;
    }
    cards = await loadChangedCards(config.changedFiles);
  } else {
    cards = (await loadAllCards()).map(({ card }) => card);
  }

  let urls = collectArchivableUrls(cards);
  const totalCollected = urls.length;
  if (config.mode === "batch") {
    urls = selectBatch(urls, config.batch, config.offsetKey);
  }

  console.log(
    `archive-sources: mode=${config.mode} collected=${totalCollected} to-archive=${urls.length}` +
      (config.mode === "batch"
        ? ` (batch=${config.batch} offset-key=${config.offsetKey || "-"})`
        : ""),
  );

  let saved = 0;
  let failed = 0;
  let skipped = 0;
  const deadline = Date.now() + TIME_BUDGET_MS;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (Date.now() >= deadline) {
      skipped = urls.length - i;
      console.log(
        `archive-sources: time budget reached — skipping ${skipped} remaining URL(s).`,
      );
      break;
    }

    const result = await savePageNow(url);
    if (result.ok) {
      saved++;
      console.log(`  saved  [${result.status}] ${url}`);
    } else {
      failed++;
      console.log(
        `  failed [${result.status || "ERR"}] ${url}${result.error ? ` (${result.error})` : ""}`,
      );
    }

    // Space out sequential requests, but not after the final one.
    if (i < urls.length - 1 && Date.now() + DELAY_MS < deadline) {
      await sleep(DELAY_MS);
    }
  }

  console.log(
    `archive-sources: done — saved=${saved} failed=${failed} skipped=${skipped} (of ${urls.length} attempted-set, ${totalCollected} collected)`,
  );
}

const isDirectRun = /scripts\/archive-sources\.(ts|js|mjs)$/.test(
  process.argv[1] ?? "",
);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
