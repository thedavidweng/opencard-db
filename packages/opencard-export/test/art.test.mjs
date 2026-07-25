// Tests for the graduation-art logic: sha256 hashing, PNG IHDR dimension
// parsing, the DB known-SHA set, three-tier classification, and the provenance
// block shape. Pure functions, no I/O — every byte here is synthetic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  sha256,
  parsePngDimensions,
  knownShaSet,
  artFacts,
  buildProvenanceBlock,
  provenanceSnippet,
  today,
} from '../lib/art.mjs';

// A 64-hex-char placeholder helper (schema pattern: ^[a-f0-9]{64}$).
const HEX = (seed) => createHash('sha256').update(String(seed)).digest('hex');

// Minimal synthetic PNG: 8-byte magic + IHDR chunk with width=4, height=3. Only
// bytes 0..23 matter to parsePngDimensions; the rest is filler.
function synthPng(width = 4, height = 3) {
  const head = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // magic
    0x00, 0x00, 0x00, 0x0d, // IHDR length (13)
    0x49, 0x48, 0x44, 0x52, // "IHDR"
  ]);
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(width, 0);
  dims.writeUInt32BE(height, 4);
  const rest = Buffer.from([0x08, 0x06, 0x00, 0x00, 0x00]); // bit depth etc.
  return Buffer.concat([head, dims, rest]);
}

test('sha256 is lowercase 64-hex and matches node:crypto', () => {
  const buf = Buffer.from('hello world');
  const h = sha256(buf);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(h, createHash('sha256').update(buf).digest('hex'));
});

test('parsePngDimensions reads width/height from the IHDR header', () => {
  assert.deepEqual(parsePngDimensions(synthPng(4, 3)), { width: 4, height: 3 });
  assert.deepEqual(parsePngDimensions(synthPng(1290, 810)), {
    width: 1290,
    height: 810,
  });
});

test('parsePngDimensions rejects non-PNG / truncated buffers', () => {
  assert.equal(parsePngDimensions(Buffer.from([1, 2, 3, 4])), null);
  assert.equal(parsePngDimensions(Buffer.alloc(0)), null);
  // Correct magic but too short to hold an IHDR.
  assert.equal(
    parsePngDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])),
    null,
  );
  // Right length but wrong chunk type.
  const bad = synthPng(4, 3);
  bad.write('IEND', 12, 'ascii');
  assert.equal(parsePngDimensions(bad), null);
});

test('knownShaSet unions provenance source, alternates, and history sources', () => {
  const src = HEX('src');
  const alt1 = HEX('alt1');
  const alt2 = HEX('alt2');
  const hist = HEX('hist');
  const card = {
    image: {
      local_path: 'images/x.webp',
      provenance: { source: 'apple-pay', source_sha256: src, alternate_sha256: [alt1, alt2] },
      history: [
        { local_path: 'images/archive/x.2025-01-01.webp', source: 'issuer-site', source_sha256: hist },
        { local_path: 'images/archive/y.webp', source: 'other', source_sha256: null },
      ],
    },
  };
  const set = knownShaSet(card);
  assert.equal(set.size, 4);
  for (const s of [src, alt1, alt2, hist]) assert.ok(set.has(s), s);
});

test('knownShaSet is empty for a card with no art / no provenance', () => {
  assert.equal(knownShaSet(null).size, 0);
  assert.equal(knownShaSet({ image: null }).size, 0);
  assert.equal(knownShaSet({ image: { url: 'https://e/x.png' } }).size, 0);
});

test('artFacts: sameArt when the local sha is anywhere in the lineage', () => {
  const local = HEX('local');
  // exact provenance source match
  assert.deepEqual(
    artFacts({ image: { local_path: 'x', provenance: { source: 'apple-pay', source_sha256: local } } }, local),
    { dbArt: 'apple-pay', sameArt: true },
  );
  // alternate_sha256 match
  assert.equal(
    artFacts(
      { image: { local_path: 'x', provenance: { source: 'apple-pay', source_sha256: HEX('other'), alternate_sha256: [local] } } },
      local,
    ).sameArt,
    true,
  );
  // history match (current art is issuer-site, the sha lives in history)
  assert.deepEqual(
    artFacts(
      { image: { local_path: 'x', provenance: { source: 'issuer-site', source_sha256: HEX('o') }, history: [{ local_path: 'images/archive/x.webp', source: 'apple-pay', source_sha256: local }] } },
      local,
    ),
    { dbArt: 'issuer', sameArt: true },
  );
});

test('artFacts: apple-pay art with a different sha is not sameArt', () => {
  const card = {
    image: { local_path: 'x', provenance: { source: 'apple-pay', source_sha256: HEX('db') } },
  };
  assert.deepEqual(artFacts(card, HEX('mine')), { dbArt: 'apple-pay', sameArt: false });
});

test('artFacts: issuer-site or provenance-less art reports dbArt issuer', () => {
  assert.deepEqual(
    artFacts({ image: { local_path: 'x', provenance: { source: 'issuer-site', source_sha256: HEX('db') } } }, HEX('mine')),
    { dbArt: 'issuer', sameArt: false },
  );
  assert.deepEqual(artFacts({ image: { url: 'https://e/x.png' } }, HEX('mine')), {
    dbArt: 'issuer',
    sameArt: false,
  });
});

test('artFacts: no art reports dbArt none', () => {
  assert.deepEqual(artFacts({ image: null }, HEX('mine')), { dbArt: 'none', sameArt: false });
  assert.deepEqual(artFacts({}, HEX('mine')), { dbArt: 'none', sameArt: false });
  assert.deepEqual(artFacts({ image: { url: null, local_path: null } }, HEX('mine')), {
    dbArt: 'none',
    sameArt: false,
  });
});

test('buildProvenanceBlock has the schema field order and omits null dims', () => {
  const sha = HEX('s');
  const block = buildProvenanceBlock({ sha256: sha, width: 1290, height: 810, exportedAt: '2026-07-25' });
  assert.deepEqual(Object.keys(block), ['source', 'source_sha256', 'width', 'height', 'exported_at']);
  assert.equal(block.source, 'apple-pay');
  assert.equal(block.source_sha256, sha);
  assert.equal(block.width, 1290);
  assert.equal(block.exported_at, '2026-07-25');

  const noDims = buildProvenanceBlock({ sha256: sha, width: null, height: null, exportedAt: '2026-07-25' });
  assert.deepEqual(Object.keys(noDims), ['source', 'source_sha256', 'exported_at']);
});

test('provenanceSnippet is a paste-ready 2-space "provenance": {…} block', () => {
  const block = buildProvenanceBlock({ sha256: HEX('s'), width: 4, height: 3, exportedAt: '2026-07-25' });
  const snip = provenanceSnippet(block);
  assert.ok(snip.startsWith('"provenance": {\n'), snip);
  assert.match(snip, /^  "source": "apple-pay",$/m);
  // Parses back when wrapped as an object.
  const parsed = JSON.parse('{' + snip + '}');
  assert.deepEqual(parsed.provenance, block);
});

test('today returns a YYYY-MM-DD string', () => {
  assert.match(today(new Date('2026-07-25T10:00:00Z')), /^2026-07-25$/);
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});
