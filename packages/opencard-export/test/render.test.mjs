// Tests for dot-list rendering, CJK width, completeness (meter + per-field), NO_COLOR.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayWidth,
  stripAnsi,
  completenessMeter,
  completenessFields,
  renderCardEntry,
  colorEnabled,
} from '../lib/render.mjs';

test('displayWidth counts CJK as 2 and ASCII as 1', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('钱包'), 4);
  assert.equal(displayWidth('卡a'), 3);
});

test('displayWidth ignores ANSI escapes', () => {
  assert.equal(displayWidth('\x1b[1mabc\x1b[0m'), 3);
});

test('stripAnsi removes escape codes', () => {
  assert.equal(stripAnsi('\x1b[32mgreen\x1b[0m'), 'green');
});

test('colorEnabled respects NO_COLOR', () => {
  assert.equal(colorEnabled({ NO_COLOR: '1' }), false);
  assert.equal(colorEnabled({}), true);
});

test('completenessMeter counts populated fields out of 6', () => {
  const full = {
    annual_fee: { amount: 95, currency: 'USD' },
    apr: { purchase: { min: 20, max: 28 } },
    fx_fee: { percent: 0 },
    rewards: { base_rate: { points_per_dollar: 1 } },
    signup_bonus: { amount: 60000 },
    image: { url: 'https://example.com/x.png' },
  };
  const mFull = completenessMeter(full);
  assert.equal(mFull.filled, 6);
  assert.equal(mFull.total, 6);
  assert.equal(mFull.text, '▮▮▮▮▮▮ 6/6');

  const empty = {
    annual_fee: { amount: null, currency: 'USD' },
    apr: {},
    fx_fee: { percent: null },
    rewards: { base_rate: { points_per_dollar: null } },
    signup_bonus: null,
    image: { url: null, local_path: null },
  };
  const mEmpty = completenessMeter(empty);
  assert.equal(mEmpty.filled, 0);
  assert.equal(mEmpty.text, '▯▯▯▯▯▯ 0/6');

  const partial = {
    annual_fee: { amount: 0, currency: 'USD' },
    image: { local_path: 'images/x.webp' },
    rewards: { base_rate: { points_per_dollar: 2 } },
  };
  assert.equal(completenessMeter(partial).filled, 3);
  assert.equal(completenessMeter(null).filled, 0);
});

test('completenessFields returns the six labels in fixed order with correct marks', () => {
  const card = {
    annual_fee: { amount: 95 },
    // apr missing
    fx_fee: { percent: 0 },
    // rewards missing
    signup_bonus: { amount: 60000 },
    image: { url: 'https://example.com/x.png' },
  };
  const fields = completenessFields(card);
  assert.deepEqual(
    fields.map((f) => f.label),
    ['Fee', 'APR', 'FX', 'Rewards', 'Bonus', 'Art'],
  );
  assert.deepEqual(
    fields.map((f) => f.ok),
    [true, false, true, false, true, true],
  );
});

test('renderCardEntry: matched card renders dot-list with per-field marks (no ANSI when color:false)', () => {
  const meter = completenessMeter({
    annual_fee: { amount: 95 },
    apr: { purchase: { min: 20, max: 28 } },
    fx_fee: { percent: 0 },
    rewards: { base_rate: { points_per_dollar: 1 } },
    // signup_bonus missing
    image: { url: 'https://example.com/x.png' },
  });
  const out = renderCardEntry(
    {
      name: 'Sample Preferred',
      issuer: 'Sample Bank',
      stateCode: 'has-art',
      matchedId: 'us-sample-preferred',
      fields: meter.fields,
    },
    { color: false, width: 60 },
  );
  assert.equal(stripAnsi(out), out, 'no ANSI when color:false');
  const [line1, line2] = out.split('\n');
  // Line 1: dot + bold name + (issuer) + right-aligned status word.
  assert.ok(line1.startsWith('● Sample Preferred (Sample Bank)'), line1);
  assert.ok(line1.endsWith('complete'), line1);
  assert.equal(displayWidth(line1), 60, 'status word is right-aligned to width');
  // Line 2: matched id + per-field ✓/✗ marks, indented and arrowed.
  assert.equal(
    line2,
    '  → us-sample-preferred · Fee ✓ APR ✓ FX ✓ Rewards ✓ Bonus ✗ Art ✓',
  );
});

test('renderCardEntry: missing-art card shows yellow-state word and Art ✗', () => {
  const meter = completenessMeter({
    annual_fee: { amount: 0 },
    image: { url: null, local_path: null },
  });
  const out = renderCardEntry(
    {
      name: 'Cobalt Everyday',
      issuer: 'Sample Bank',
      stateCode: 'needs-art',
      matchedId: 'ca-sample-cobalt',
      fields: meter.fields,
    },
    { color: false, width: 60 },
  );
  const [line1, line2] = out.split('\n');
  assert.ok(line1.endsWith('missing art'), line1);
  assert.ok(line2.endsWith('Art ✗'), line2);
});

test('renderCardEntry: unmatched card shows red-state word and the not-in-DB hint', () => {
  const out = renderCardEntry(
    { name: 'My Local Credit Union', issuer: 'Some CU', stateCode: 'not-in-db', matchedId: null },
    { color: false, width: 60 },
  );
  const [line1, line2] = out.split('\n');
  assert.ok(line1.endsWith('not in DB'), line1);
  assert.equal(line2, '  → not in OpenCard DB yet');
});

test('renderCardEntry: CJK card names keep width-correct right alignment', () => {
  const out = renderCardEntry(
    { name: '招商银行经典白金卡', issuer: '招商银行', stateCode: 'not-in-db', matchedId: null },
    { color: false, width: 64 },
  );
  const line1 = out.split('\n')[0];
  assert.equal(displayWidth(line1), 64, 'CJK name still aligns the status word');
  assert.ok(line1.startsWith('● 招商银行经典白金卡 (招商银行)'), line1);
});

test('renderCardEntry: color:true emits ANSI but strips to the plain layout', () => {
  const colored = renderCardEntry(
    { name: 'Sample', issuer: 'Bank', stateCode: 'not-in-db', matchedId: null },
    { color: true, width: 40 },
  );
  assert.notEqual(stripAnsi(colored), colored, 'ANSI present when color:true');
  const plain = renderCardEntry(
    { name: 'Sample', issuer: 'Bank', stateCode: 'not-in-db', matchedId: null },
    { color: false, width: 40 },
  );
  assert.equal(stripAnsi(colored), plain, 'stripped colored output equals plain output');
});
