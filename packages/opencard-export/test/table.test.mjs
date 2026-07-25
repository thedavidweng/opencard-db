// Tests for table rendering, CJK width, completeness meter, and NO_COLOR.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayWidth,
  stripAnsi,
  completenessMeter,
  renderTable,
  colorEnabled,
} from '../lib/table.mjs';

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

test('renderTable with color=false produces no ANSI and aligned CJK columns', () => {
  const columns = [
    { key: 'a', title: '钱包卡片' },
    { key: 'b', title: 'x' },
  ];
  const rows = [
    { a: '招商银行', b: '1' },
    { a: 'Chase', b: '22' },
  ];
  const out = renderTable(columns, rows, { color: false });
  assert.equal(stripAnsi(out), out, 'no ANSI when color=false');
  const lines = out.split('\n');
  // Every rendered line must have identical display width (aligned borders).
  const widths = new Set(lines.map((l) => displayWidth(l)));
  assert.equal(widths.size, 1, 'all rows share one display width');
});
