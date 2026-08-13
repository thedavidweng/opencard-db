import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  isOpencardRepo,
  findOpencardRepo,
  loadRepoCards,
} from '../lib/catalog.mjs';

test('isOpencardRepo requires schema.json + data/ + images/', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-cat-'));
  try {
    assert.equal(await isOpencardRepo(dir), false);
    await fs.writeFile(path.join(dir, 'schema.json'), '{}');
    await fs.mkdir(path.join(dir, 'data'));
    await fs.mkdir(path.join(dir, 'images'));
    assert.equal(await isOpencardRepo(dir), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('findOpencardRepo walks up from a subdirectory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-cat-'));
  try {
    await fs.writeFile(path.join(dir, 'schema.json'), '{}');
    await fs.mkdir(path.join(dir, 'data'));
    await fs.mkdir(path.join(dir, 'images'));
    const nested = path.join(dir, 'packages', 'cli');
    await fs.mkdir(nested, { recursive: true });
    assert.equal(await findOpencardRepo(nested), dir);
    assert.equal(await findOpencardRepo(os.tmpdir()), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('loadRepoCards reads data/{country}/*.json and skips junk', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-cat-'));
  try {
    await fs.mkdir(path.join(dir, 'data', 'us'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'data', 'us', 'demo.json'),
      JSON.stringify({ id: 'us-demo', name: 'Demo' }),
    );
    await fs.writeFile(path.join(dir, 'data', 'us', 'broken.json'), '{');
    await fs.writeFile(
      path.join(dir, 'data', 'issuers.json'),
      JSON.stringify({ issuers: [] }),
    );
    const cards = await loadRepoCards(dir);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, 'us-demo');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
