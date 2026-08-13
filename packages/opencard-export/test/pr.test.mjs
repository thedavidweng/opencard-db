import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildArtPr, nextStepCommands } from '../lib/pr.mjs';

const GOLD = {
  id: 'us-amex-gold',
  name: 'American Express® Gold Card',
  country: 'us',
  issuer: 'American Express',
  network: 'amex',
  network_tier: 'none',
  official_url: 'https://www.americanexpress.com/gold',
  sources: ['https://www.americanexpress.com/gold'],
  annual_fee: { amount: 325, currency: 'USD' },
  signup_bonus: { amount: 60000, unit: 'points' },
};

test('buildArtPr for one card is a card(update) with Apple Pay option B', () => {
  const spec = buildArtPr([GOLD], '2026-08-13');
  assert.equal(spec.title, 'card(update): us-amex-gold');
  assert.equal(spec.kind, 'card-update');
  assert.match(spec.body, /Update existing card/);
  assert.match(spec.body, /us-amex-gold/);
  assert.match(spec.body, /data\/us\/amex-gold\.json/);
  assert.match(spec.body, /\*\*B\. Apple Pay extract/);
  assert.match(spec.body, /2026-08-13/);
  assert.match(spec.body, /American Express/);
});

test('buildArtPr for several cards uses the bulk Not-a-card form', () => {
  const spec = buildArtPr([GOLD, { id: 'us-amex-green', name: 'Green' }], '2026-08-13');
  assert.equal(spec.title, 'fix(data): add Apple Pay card art');
  assert.equal(spec.kind, 'bulk');
  assert.match(spec.body, /Not a card/);
  assert.match(spec.body, /us-amex-gold/);
  assert.match(spec.body, /us-amex-green/);
});

test('buildArtPr returns null for an empty list', () => {
  assert.equal(buildArtPr([], '2026-08-13'), null);
});

test('nextStepCommands lists git + gh in order', () => {
  const cmds = nextStepCommands({
    branch: 'card-art/us-amex-gold',
    files: ['images/us-amex-gold.png', 'data/us/amex-gold.json'],
    title: 'card(update): us-amex-gold',
    bodyFile: '.git/opencard-export-pr.md',
  });
  assert.match(cmds[0], /git checkout -b card-art\/us-amex-gold/);
  assert.match(cmds[1], /git add /);
  assert.match(cmds[2], /git commit -m "card\(update\): us-amex-gold"/);
  assert.match(cmds[3], /git push/);
  assert.match(cmds[4], /gh pr create/);
});
