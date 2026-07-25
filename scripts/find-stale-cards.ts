#!/usr/bin/env node
/**
 * Find cards whose `last_verified` date is older than a re-verification window
 * (STALE_DAYS, default 180). Prints a JSON array to stdout, most stale first:
 *
 *   [{ id, file, last_verified, days }]
 *
 * `file` is repo-relative (e.g. `data/us/amex-gold.json`) so the weekly
 * stale-cards workflow can both read the file and link to it on GitHub.
 *
 * Env: STALE_DAYS — integer number of days before a card is considered stale.
 *
 * The core logic (`daysSince`, `findStaleCards`) is pure with an injectable
 * `today`, so it can be unit-tested without touching the clock or disk.
 */
import path from "node:path";
import { loadAllCards, repoRoot, type Card } from "./lib.ts";

export type StaleCard = {
  id: string;
  file: string;
  last_verified: string;
  days: number;
};

export const DEFAULT_STALE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between an ISO `YYYY-MM-DD` date and `today`, compared in UTC so
 * the result never drifts with the CI runner's timezone. Returns NaN when
 * `lastVerified` is not a parseable calendar date.
 */
export function daysSince(lastVerified: string, today: Date): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastVerified)) return NaN;
  const then = Date.parse(`${lastVerified}T00:00:00Z`);
  if (Number.isNaN(then)) return NaN;
  const now = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return Math.floor((now - then) / DAY_MS);
}

/**
 * Pure: given loaded cards, a staleness threshold, and `today`, return the
 * cards whose `last_verified` is strictly more than `staleDays` old, sorted
 * most-stale first. Cards with a missing / unparseable `last_verified` are
 * skipped (schema validation is a separate concern).
 */
export function findStaleCards(
  cards: { file: string; card: Card }[],
  staleDays: number,
  today: Date,
): StaleCard[] {
  const out: StaleCard[] = [];
  for (const { file, card } of cards) {
    const lastVerified = card.last_verified;
    if (typeof lastVerified !== "string") continue;
    const days = daysSince(lastVerified, today);
    if (Number.isNaN(days)) continue;
    if (days > staleDays) {
      out.push({ id: card.id, file, last_verified: lastVerified, days });
    }
  }
  out.sort((a, b) => b.days - a.days || a.id.localeCompare(b.id));
  return out;
}

function parseStaleDays(raw: string | undefined): number {
  if (!raw || !raw.trim()) return DEFAULT_STALE_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_STALE_DAYS;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const staleDays = parseStaleDays(process.env.STALE_DAYS);
  const loaded = await loadAllCards();
  const cards = loaded.map(({ file, card }) => ({
    file: path.relative(root, file),
    card,
  }));
  const stale = findStaleCards(cards, staleDays, new Date());
  process.stdout.write(JSON.stringify(stale, null, 2) + "\n");
}

const isDirectRun = /scripts\/find-stale-cards\.(ts|js|mjs)$/.test(
  process.argv[1] ?? "",
);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
