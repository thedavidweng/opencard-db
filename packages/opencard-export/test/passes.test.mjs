// Unit + integration tests for pass scanning/classification.
// All fixtures use INVENTED values — no real Wallet data is read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  parsePassJson,
  classifyPass,
  pickArtAsset,
  extractInfo,
  scanCards,
  PASSBOOK_STYLE_KEYS,
} from '../lib/passes.mjs';

test('parsePassJson decodes UTF-8', () => {
  const buf = Buffer.from(JSON.stringify({ storeCard: {}, description: 'X' }), 'utf-8');
  const obj = parsePassJson(buf);
  assert.equal(obj.description, 'X');
});

test('parsePassJson decodes UTF-16 LE with BOM', () => {
  const buf = Buffer.from('﻿' + JSON.stringify({ description: 'Wide' }), 'utf16le');
  const obj = parsePassJson(buf);
  assert.equal(obj.description, 'Wide');
});

test('parsePassJson decodes UTF-16 BE with BOM', () => {
  const le = Buffer.from('﻿' + JSON.stringify({ description: 'BE' }), 'utf16le');
  // Byte-swap LE -> BE to simulate a big-endian file.
  const be = Buffer.from(le);
  for (let i = 0; i + 1 < be.length; i += 2) {
    const t = be[i];
    be[i] = be[i + 1];
    be[i + 1] = t;
  }
  const obj = parsePassJson(be);
  assert.equal(obj.description, 'BE');
});

test('parsePassJson returns null on binary garbage', () => {
  assert.equal(parsePassJson(Buffer.from([0x00, 0x01, 0x02, 0xff])), null);
  assert.equal(parsePassJson(Buffer.alloc(0)), null);
});

test('classifyPass: passbook styles are NON-payment and never exportable', () => {
  for (const style of PASSBOOK_STYLE_KEYS) {
    const passJson = { [style]: {}, organizationName: 'Loyalty Co', description: 'Loyalty' };
    const cls = classifyPass({ passJson, assetNames: ['icon.png', 'strip@2x.png', 'logo.png'] });
    assert.equal(cls.kind, 'passbook', `${style} should be passbook`);
    assert.equal(cls.exportable, false);
    assert.equal(cls.style, style);
  }
});

test('classifyPass: cardBackgroundCombined art => payment + exportable', () => {
  const cls = classifyPass({
    passJson: { description: 'Sample Rewards Card', organizationName: 'Sample Bank' },
    assetNames: ['icon.png', 'cardBackgroundCombined@2x.png', 'logo@2x.png'],
  });
  assert.equal(cls.kind, 'payment');
  assert.equal(cls.exportable, true);
  assert.equal(cls.artAsset, 'cardBackgroundCombined@2x.png');
});

test('classifyPass: paymentApplications but no art => payment, not exportable', () => {
  const cls = classifyPass({
    passJson: { paymentApplications: [{ applicationIdentifier: 'AABBCC' }] },
    assetNames: ['icon.png'],
  });
  assert.equal(cls.kind, 'payment');
  assert.equal(cls.exportable, false);
});

test('classifyPass: parsed JSON with no style key => payment shell (no art)', () => {
  const cls = classifyPass({
    passJson: { organizationName: 'Sample Bank', description: 'Sample Card' },
    assetNames: ['icon.png', 'logo.png'],
  });
  assert.equal(cls.kind, 'payment');
  assert.equal(cls.exportable, false);
});

test('classifyPass: unparseable + no art => unknown', () => {
  const cls = classifyPass({ passJson: null, assetNames: ['icon.png'] });
  assert.equal(cls.kind, 'unknown');
  assert.equal(cls.exportable, false);
});

test('pickArtAsset prefers @2x then @3x then base', () => {
  assert.equal(
    pickArtAsset(['cardBackgroundCombined.png', 'cardBackgroundCombined@2x.png', 'cardBackgroundCombined@3x.png']),
    'cardBackgroundCombined@2x.png',
  );
  assert.equal(
    pickArtAsset(['cardBackgroundCombined.png', 'cardBackgroundCombined@3x.png']),
    'cardBackgroundCombined@3x.png',
  );
  assert.equal(pickArtAsset(['strip@2x.png', 'icon.png']), 'strip@2x.png');
  assert.equal(pickArtAsset(['icon.png', 'logo.png']), null);
});

test('extractInfo prefers description, exposes suffix only when present, never fabricates PAN', () => {
  const info = extractInfo({ description: 'Sample Card', organizationName: 'Sample Bank' });
  assert.equal(info.name, 'Sample Card');
  assert.equal(info.issuer, 'Sample Bank');
  assert.equal(info.suffix, null);

  const withSuffix = extractInfo({ organizationName: 'Sample Bank', primaryAccountNumberSuffix: '4242' });
  assert.equal(withSuffix.name, 'Sample Bank');
  assert.equal(withSuffix.suffix, '4242');
});

// ── integration: build a synthetic Cards dir and verify scan + art export ────
test('scanCards + copy: synthetic payment card exports a PNG file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-cards-'));
  try {
    // Synthetic PAYMENT bundle: no style key + real art asset.
    const pay = path.join(root, 'AAAApayment.pkpass');
    await fs.mkdir(pay, { recursive: true });
    await fs.writeFile(
      path.join(pay, 'pass.json'),
      JSON.stringify({ description: 'Sample Rewards Visa', organizationName: 'Sample Bank' }),
    );
    // Invented PNG bytes (valid PNG signature + minimal chunk-ish payload).
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await fs.writeFile(path.join(pay, 'cardBackgroundCombined@2x.png'), pngBytes);

    // Synthetic PASSBOOK bundle: storeCard style, must never be exportable.
    const loy = path.join(root, 'BBBBloyalty.pkpass');
    await fs.mkdir(loy, { recursive: true });
    await fs.writeFile(
      path.join(loy, 'pass.json'),
      JSON.stringify({ storeCard: {}, organizationName: 'Coffee Co', description: 'Coffee Rewards' }),
    );
    await fs.writeFile(path.join(loy, 'strip@2x.png'), Buffer.from([1, 2, 3]));

    const recs = await scanCards(root);
    assert.equal(recs.length, 2);
    const payRec = recs.find((r) => r.bundle.includes('payment'));
    const loyRec = recs.find((r) => r.bundle.includes('loyalty'));

    assert.equal(payRec.kind, 'payment');
    assert.equal(payRec.exportable, true);
    assert.equal(payRec.artAsset, 'cardBackgroundCombined@2x.png');
    assert.equal(loyRec.kind, 'passbook');
    assert.equal(loyRec.exportable, false);

    // Simulate export copy (what the CLI does for exportable cards).
    const outDir = path.join(root, 'out');
    await fs.mkdir(outDir);
    const dest = path.join(outDir, 'us-sample-card.png');
    await fs.copyFile(path.join(payRec.bundleDir, payRec.artAsset), dest);
    const stat = await fs.stat(dest);
    assert.ok(stat.size > 0, 'exported PNG should be non-empty');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
