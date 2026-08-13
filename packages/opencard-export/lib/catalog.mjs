// Load Card records from an OpenCard DB checkout (data/{country}/*.json).
// Used so --repo / a cwd checkout compares against live data/ (including
// provenance just written) instead of a stale exports/cards-all.json.

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * True when `dir` looks like an OpenCard DB checkout.
 * @param {string|null|undefined} dir
 * @returns {Promise<boolean>}
 */
export async function isOpencardRepo(dir) {
  if (!dir) return false;
  try {
    await fs.access(path.join(dir, 'schema.json'));
    await fs.access(path.join(dir, 'images'));
    await fs.access(path.join(dir, 'data'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `start` until an OpenCard DB checkout is found.
 * @param {string} start
 * @returns {Promise<string|null>}
 */
export async function findOpencardRepo(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (await isOpencardRepo(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read every card JSON under data/{country}/. Skips unreadable files.
 * @param {string} repoRoot
 * @returns {Promise<object[]>}
 */
export async function loadRepoCards(repoRoot) {
  const dataDir = path.join(repoRoot, 'data');
  let entries;
  try {
    entries = await fs.readdir(dataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const cards = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const dir = path.join(dataDir, ent.name);
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const card = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
        if (card && typeof card === 'object' && card.id) cards.push(card);
      } catch {
        // skip broken files; validate.ts is the place that fails the repo
      }
    }
  }
  return cards;
}
