// End-to-end CLI tests: drive bin/opencard-export.mjs against synthetic
// --passes-dir fixtures and a local synthetic DB (OPENCARD_DB_FILE). No network,
// no real Wallet data — every value here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'opencard-export.mjs');

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s) => String(s).replace(ANSI_RE, '');

function runCli(args, env = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  return { code: res.status, stdout: strip(res.stdout || ''), stderr: strip(res.stderr || '') };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function writePaymentBundle(root, dirName, passJson) {
  const dir = path.join(root, dirName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'pass.json'), JSON.stringify(passJson));
  await fs.writeFile(path.join(dir, 'cardBackgroundCombined@2x.png'), PNG);
}

async function writePassbookBundle(root, dirName, style, passJson) {
  const dir = path.join(root, dirName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'pass.json'),
    JSON.stringify({ [style]: {}, ...passJson }),
  );
  await fs.writeFile(path.join(dir, 'strip@2x.png'), Buffer.from([1, 2, 3]));
}

// A tiny synthetic DB: one fully-populated card WITH art, one in-DB card MISSING art.
const SYNTH_DB = [
  {
    id: 'nw-aurora-signature',
    name: 'Aurora Signature Card',
    issuer: 'Northwind Bank',
    annual_fee: { amount: 95, currency: 'USD' },
    apr: { purchase: { min: 20, max: 28 } },
    fx_fee: { percent: 0 },
    rewards: { base_rate: { points_per_dollar: 1 } },
    signup_bonus: { amount: 60000 },
    image: { url: 'https://example.com/aurora.png' },
  },
  {
    id: 'nw-cobalt-everyday',
    name: 'Cobalt Everyday Card',
    issuer: 'Northwind Bank',
    annual_fee: { amount: 0, currency: 'USD' },
    rewards: { base_rate: { points_per_dollar: 2 } },
    // No apr / fx_fee / signup_bonus / image on purpose.
  },
];

async function threeCardFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-cli-'));
  await writePaymentBundle(root, 'AAAA.pkpass', {
    description: 'Aurora Signature',
    organizationName: 'Northwind Bank',
  });
  await writePaymentBundle(root, 'BBBB.pkpass', {
    description: 'Cobalt Everyday',
    organizationName: 'Northwind Bank',
  });
  await writePaymentBundle(root, 'CCCC.pkpass', {
    description: 'Nimbus Rewards',
    organizationName: 'Riverside CU',
  });
  await writePassbookBundle(root, 'DDDD.pkpass', 'storeCard', {
    organizationName: 'Coffee Co',
    description: 'Coffee Rewards',
  });
  await writePassbookBundle(root, 'EEEE.pkpass', 'boardingPass', {
    organizationName: 'Air Co',
    description: 'Flight 100',
  });
  const dbFile = path.join(root, 'db.json');
  await fs.writeFile(dbFile, JSON.stringify(SYNTH_DB));
  return { root, dbFile };
}

test('dot-list: renders each state, per-field marks, summary, and ignored-count line', async () => {
  const { root, dbFile } = await threeCardFixture();
  try {
    const { code, stdout } = runCli(['--passes-dir', root], { OPENCARD_DB_FILE: dbFile });
    assert.equal(code, 0, stdout);

    // Header (version from package.json, single source).
    assert.match(stdout, /opencard-export v0\.2\.0/);
    assert.match(stdout, /OpenCard DB · github\.com\/thedavidweng\/opencard-db/);

    // Green (complete) card + full per-field marks with matched id.
    assert.ok(stdout.includes('● Aurora Signature (Northwind Bank)'), stdout);
    assert.ok(
      stdout.includes('→ nw-aurora-signature · Fee ✓ APR ✓ FX ✓ Rewards ✓ Bonus ✓ Art ✓'),
      stdout,
    );

    // Yellow (missing art) card: Art ✗ and some other ✗ marks.
    assert.ok(stdout.includes('● Cobalt Everyday (Northwind Bank)'), stdout);
    assert.ok(
      stdout.includes('→ nw-cobalt-everyday · Fee ✓ APR ✗ FX ✗ Rewards ✓ Bonus ✗ Art ✗'),
      stdout,
    );

    // Red (not in DB) card: the not-in-DB hint line.
    assert.ok(stdout.includes('● Nimbus Rewards (Riverside CU)'), stdout);
    assert.ok(stdout.includes('→ not in OpenCard DB yet'), stdout);

    // Status words appear on the card lines.
    assert.match(stdout, /complete/);
    assert.match(stdout, /missing art/);
    assert.match(stdout, /not in DB/);

    // Footer-style summary line.
    assert.ok(
      stdout.includes('3 payment cards · 1 complete · 1 missing art · 1 not in DB'),
      stdout,
    );

    // Ignored non-payment passes: exactly one dimmed line.
    assert.ok(
      stdout.includes(
        'Ignored 2 non-payment passes (loyalty cards, tickets, boarding passes).',
      ),
      stdout,
    );
    // Non-payment passes are never listed by name.
    assert.ok(!stdout.includes('Coffee'), 'non-payment pass name must not appear');
    assert.ok(!stdout.includes('Flight'), 'non-payment pass name must not appear');

    // Next steps with copy-pasteable command + issue-form URL.
    assert.match(stdout, /Next steps:/);
    assert.ok(stdout.includes('npx opencard-export --export'), stdout);
    assert.ok(stdout.includes('images/<card-id>.png'), stdout);
    assert.ok(
      stdout.includes(
        'https://github.com/thedavidweng/opencard-db/issues/new?template=add-card.yml',
      ),
      stdout,
    );

    // Attribution footer (English).
    assert.match(stdout, /Card art remains the copyright of the issuing bank/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('empty state: no payment cards prints the friendly block, no "all in DB" claim', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-empty-'));
  try {
    await writePassbookBundle(root, 'AAAA.pkpass', 'storeCard', {
      organizationName: 'Coffee Co',
      description: 'Coffee Rewards',
    });
    await writePassbookBundle(root, 'BBBB.pkpass', 'eventTicket', {
      organizationName: 'Venue Co',
      description: 'Concert',
    });
    const { code, stdout } = runCli(['--passes-dir', root, '--no-remote']);
    assert.equal(code, 0, stdout);
    assert.ok(stdout.includes('No Apple Pay payment cards found in Wallet.'), stdout);
    assert.ok(
      stdout.includes(
        'Ignored 2 non-payment passes (loyalty cards, tickets, boarding passes).',
      ),
      stdout,
    );
    assert.match(stdout, /contributes Apple Pay card art to OpenCard DB/);
    // The reviewed bug: never claim the user's cards are all in the DB.
    assert.ok(!/all your cards are in the DB/i.test(stdout), stdout);
    assert.ok(!/All matched cards are complete/i.test(stdout), stdout);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('unknown flags (including the removed --all) are rejected with a helpful error', () => {
  const { code, stderr } = runCli(['--all', '--passes-dir', '/tmp']);
  assert.notEqual(code, 0);
  assert.match(stderr, /unknown option '--all'/);
  assert.match(stderr, /--help/);
});

test('--json omits non-payment passes and reports ignored count + per-state summary', async () => {
  const { root, dbFile } = await threeCardFixture();
  try {
    const { code, stdout } = runCli(['--passes-dir', root, '--json'], {
      OPENCARD_DB_FILE: dbFile,
    });
    assert.equal(code, 0, stdout);
    const out = JSON.parse(stdout);
    assert.equal(out.walletCards.length, 3);
    assert.equal(out.ignoredNonPayment, 2);
    assert.equal(out.summary.paymentCards, 3);
    assert.equal(out.summary.complete, 1);
    assert.equal(out.summary.missingArt, 1);
    assert.equal(out.summary.notInDb, 1);
    // The old --all-only key must be gone.
    assert.ok(!('nonPaymentPasses' in out), 'nonPaymentPasses key removed');
    // Per-field completeness surfaces in JSON too.
    const aurora = out.walletCards.find((w) => w.matchedId === 'nw-aurora-signature');
    assert.equal(aurora.completeness.fields.image, true);
    const cobalt = out.walletCards.find((w) => w.matchedId === 'nw-cobalt-everyday');
    assert.equal(cobalt.completeness.fields.image, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
