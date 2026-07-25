// Tests for table rendering, CJK width, completeness (meter + per-field), NO_COLOR.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayWidth,
  stripAnsi,
  completenessMeter,
  completenessFields,
  renderCardTable,
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
  assert.equal(mFull.text, '6/6');

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
  assert.equal(mEmpty.text, '0/6');

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

const ROWS = [
  {
    name: 'Sample Preferred',
    issuer: 'Sample Bank',
    matchedId: 'us-sample-preferred',
    filled: 5,
    total: 6,
    status: 'up-to-date',
  },
  {
    name: 'Cobalt Everyday',
    issuer: 'Sample Bank',
    matchedId: 'ca-sample-cobalt',
    filled: 1,
    total: 6,
    status: 'art-wanted',
  },
  {
    name: 'My Local Credit Union',
    issuer: 'Some CU',
    matchedId: null,
    status: 'not-in-database',
  },
];

test('renderCardTable: header + aligned columns, no ANSI when color:false', () => {
  const out = renderCardTable(ROWS, { color: false });
  assert.equal(stripAnsi(out), out, 'no ANSI when color:false');
  const lines = out.split('\n');
  assert.equal(lines.length, 4, 'header + one line per card');
  assert.match(lines[0], /^NAME\s+ISSUER\s+MATCH\s+DATA\s+STATUS$/);
  assert.match(lines[1], /^Sample Preferred\s+Sample Bank\s+us-sample-preferred\s+5\/6\s+up to date$/);
  assert.match(lines[2], /^Cobalt Everyday\s+Sample Bank\s+ca-sample-cobalt\s+1\/6\s+art wanted$/);
  // Columns align: every MATCH cell starts at the same display offset.
  const offset = (line, text) => displayWidth(line.slice(0, line.indexOf(text)));
  assert.equal(
    offset(lines[1], 'us-sample-preferred'),
    offset(lines[0], 'MATCH'),
    'MATCH column aligns with its header',
  );
});

test('renderCardTable: unmatched card renders dash DB cells and its status', () => {
  const out = renderCardTable(ROWS, { color: false });
  const line = out.split('\n')[3];
  assert.match(line, /^My Local Credit Union\s+Some CU\s+-\s+-\s+not in database$/);
});

test('renderCardTable: null status (offline) renders a dash', () => {
  const out = renderCardTable(
    [{ name: 'Sample', issuer: 'Bank', matchedId: null, status: null }],
    { color: false },
  );
  assert.match(out.split('\n')[1], /^Sample\s+Bank\s+-\s+-\s+-$/);
});

test('renderCardTable: the three status words', () => {
  const rows = ['up-to-date', 'art-wanted'].map((status, i) => ({
    name: `Card ${i}`,
    issuer: 'Bank',
    matchedId: `xx-card-${i}`,
    filled: 3,
    total: 6,
    status,
  }));
  rows.push({ name: 'Card 2', issuer: 'Bank', matchedId: null, status: 'not-in-database' });
  const out = renderCardTable(rows, { color: false });
  assert.match(out, /xx-card-0\s+3\/6\s+up to date/);
  assert.match(out, /xx-card-1\s+3\/6\s+art wanted/);
  assert.match(out, /Card 2\s+Bank\s+-\s+-\s+not in database/);
});

test('renderCardTable: CJK names keep the columns width-aligned', () => {
  const rows = [
    {
      name: '招商银行经典白金卡',
      issuer: '招商银行',
      matchedId: 'cn-cmb-classic-platinum',
      filled: 4,
      total: 6,
      status: 'art-wanted',
    },
    {
      name: 'Short',
      issuer: 'Bank',
      matchedId: 'us-short',
      filled: 6,
      total: 6,
      status: 'up-to-date',
    },
  ];
  const out = renderCardTable(rows, { color: false });
  const [header, l1, l2] = out.split('\n');
  const offset = (line, text) => displayWidth(line.slice(0, line.indexOf(text)));
  assert.equal(offset(l1, 'cn-cmb-classic-platinum'), offset(header, 'MATCH'));
  assert.equal(offset(l2, 'us-short'), offset(header, 'MATCH'));
});

test('renderCardTable: color:true emits ANSI and strips to the plain layout', () => {
  const colored = renderCardTable(ROWS, { color: true });
  assert.notEqual(stripAnsi(colored), colored, 'ANSI present when color:true');
  const plain = renderCardTable(ROWS, { color: false });
  assert.equal(stripAnsi(colored), plain, 'stripped colored output equals plain output');
});
