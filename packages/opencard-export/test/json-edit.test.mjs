import { test } from 'node:test';
import assert from 'node:assert/strict';

import { replaceImageBlock } from '../lib/json-edit.mjs';

const CARD = `{
  "id": "us-demo",
  "annual_fee": {
    "amount": 85.0,
    "currency": "USD"
  },
  "name": "American Express® Gold Card",
  "image": {
    "url": "https://example.com/old.png",
    "attribution": "© Bank"
  },
  "notes": "keep me"
}
`;

test('replaceImageBlock leaves non-image bytes alone (including 85.0 and ®)', () => {
  const next = replaceImageBlock(CARD, {
    url: 'https://example.com/old.png',
    attribution: '© Bank (Apple Pay digital card art)',
    local_path: 'images/us-demo.png',
    provenance: { source: 'apple-pay', source_sha256: 'ab'.repeat(32) },
  });
  assert.match(next, /"amount": 85\.0/);
  assert.match(next, /American Express® Gold Card/);
  assert.match(next, /"notes": "keep me"/);
  assert.match(next, /images\/us-demo\.png/);
  assert.match(next, /apple-pay/);
});

test('replaceImageBlock handles image: null', () => {
  const raw = `{\n  "id": "us-demo",\n  "image": null\n}\n`;
  const next = replaceImageBlock(raw, { local_path: 'images/us-demo.png' });
  assert.match(next, /"local_path": "images\/us-demo.png"/);
  assert.match(next, /"id": "us-demo"/);
});

test('replaceImageBlock inserts image when the key is missing', () => {
  const raw = `{\n  "id": "us-demo",\n  "name": "Demo"\n}\n`;
  const next = replaceImageBlock(raw, { local_path: 'images/us-demo.png' });
  const parsed = JSON.parse(next);
  assert.equal(parsed.id, 'us-demo');
  assert.equal(parsed.name, 'Demo');
  assert.equal(parsed.image.local_path, 'images/us-demo.png');
});
