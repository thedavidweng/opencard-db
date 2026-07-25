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

import { sha256 } from '../lib/art.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'opencard-export.mjs');

// A real (minimal) PNG whose IHDR encodes width/height, so the CLI can hash it
// and read its dimensions. Distinct dims → distinct bytes → distinct sha.
function synthPng(width, height) {
  const head = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(width, 0);
  dims.writeUInt32BE(height, 4);
  return Buffer.concat([head, dims, Buffer.from([0x08, 0x06, 0x00, 0x00, 0x00])]);
}

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
    assert.match(stdout, /opencard-export v0\.3\.0/);
    assert.match(stdout, /OpenCard DB · github\.com\/thedavidweng\/opencard-db/);

    // Green (complete) card + full per-field marks with matched id. Aurora has
    // DB art but no apple-pay provenance → the Art tier is "upgradeable".
    assert.ok(stdout.includes('● Aurora Signature (Northwind Bank)'), stdout);
    assert.ok(
      stdout.includes('→ nw-aurora-signature · Fee ✓ APR ✓ FX ✓ Rewards ✓ Bonus ✓ Art upgradeable'),
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

    // Footer-style summary line: the tiers replace the old binary "complete".
    assert.ok(
      stdout.includes(
        '3 payment cards · 0 graduated · 0 new-design? · 1 upgradeable · 1 missing art · 1 not in DB',
      ),
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

// ── graduation tiers ────────────────────────────────────────────────────────

// Distinct PNGs per wallet card, and a DB wired so the four art tiers all occur.
const GRAD_PNG = synthPng(10, 6);
const NEWD_PNG = synthPng(20, 12);
const UPGR_PNG = synthPng(30, 18);
const MISS_PNG = synthPng(40, 24);
const GRAD_SHA = sha256(GRAD_PNG);
const OTHER_SHA = 'a'.repeat(64); // a valid-looking sha that is NOT any local export

const TIER_DB = [
  {
    id: 'nw-aurora-signature',
    name: 'Aurora Signature Card',
    issuer: 'Northwind Bank',
    country: 'nw',
    annual_fee: { amount: 95, currency: 'USD' },
    rewards: { base_rate: { points_per_dollar: 1 } },
    // graduated: the DB's apple-pay source_sha256 IS this wallet card's export.
    image: { local_path: 'images/nw-aurora-signature.webp', provenance: { source: 'apple-pay', source_sha256: GRAD_SHA } },
  },
  {
    id: 'nw-cobalt-everyday',
    name: 'Cobalt Everyday Card',
    issuer: 'Northwind Bank',
    country: 'nw',
    annual_fee: { amount: 0, currency: 'USD' },
    rewards: { base_rate: { points_per_dollar: 2 } },
    // new-design: DB art is apple-pay but a different sha.
    image: { local_path: 'images/nw-cobalt-everyday.webp', provenance: { source: 'apple-pay', source_sha256: OTHER_SHA } },
  },
  {
    id: 'nw-borealis-platinum',
    name: 'Borealis Platinum Card',
    issuer: 'Northwind Bank',
    country: 'nw',
    annual_fee: { amount: 0, currency: 'USD' },
    rewards: { base_rate: { points_per_dollar: 1 } },
    // upgradeable: DB art came from the issuer site.
    image: { url: 'https://issuer.example/borealis.png', provenance: { source: 'issuer-site', source_sha256: OTHER_SHA } },
  },
  {
    id: 'nw-nimbus-rewards',
    name: 'Nimbus Rewards Card',
    issuer: 'Northwind Bank',
    country: 'nw',
    annual_fee: { amount: 0, currency: 'USD' },
    rewards: { base_rate: { points_per_dollar: 1 } },
    // missing: no image at all.
  },
];

async function writePaymentBundleWith(root, dirName, passJson, png) {
  const dir = path.join(root, dirName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'pass.json'), JSON.stringify(passJson));
  await fs.writeFile(path.join(dir, 'cardBackgroundCombined@2x.png'), png);
}

async function fourTierFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-tier-'));
  await writePaymentBundleWith(root, 'GRAD.pkpass', { description: 'Aurora Signature', organizationName: 'Northwind Bank' }, GRAD_PNG);
  await writePaymentBundleWith(root, 'NEWD.pkpass', { description: 'Cobalt Everyday', organizationName: 'Northwind Bank' }, NEWD_PNG);
  await writePaymentBundleWith(root, 'UPGR.pkpass', { description: 'Borealis Platinum', organizationName: 'Northwind Bank' }, UPGR_PNG);
  await writePaymentBundleWith(root, 'MISS.pkpass', { description: 'Nimbus Rewards', organizationName: 'Northwind Bank' }, MISS_PNG);
  await writePaymentBundleWith(root, 'NONE.pkpass', { description: 'Mystery Card', organizationName: 'Unknown CU' }, synthPng(50, 30));
  const dbFile = path.join(root, 'db.json');
  await fs.writeFile(dbFile, JSON.stringify(TIER_DB));
  return { root, dbFile };
}

test('dot-list: renders all four art tiers, tier summary, and tier next-steps', async () => {
  const { root, dbFile } = await fourTierFixture();
  try {
    const { code, stdout } = runCli(['--passes-dir', root], { OPENCARD_DB_FILE: dbFile });
    assert.equal(code, 0, stdout);

    assert.ok(stdout.includes('→ nw-aurora-signature · Fee ✓ APR ✗ FX ✗ Rewards ✓ Bonus ✗ Art graduated'), stdout);
    assert.ok(stdout.includes('→ nw-cobalt-everyday · Fee ✓ APR ✗ FX ✗ Rewards ✓ Bonus ✗ Art new-design?'), stdout);
    assert.ok(stdout.includes('→ nw-borealis-platinum · Fee ✓ APR ✗ FX ✗ Rewards ✓ Bonus ✗ Art upgradeable'), stdout);
    assert.ok(stdout.includes('→ nw-nimbus-rewards · Fee ✓ APR ✗ FX ✗ Rewards ✓ Bonus ✗ Art ✗'), stdout);

    // Tier summary.
    assert.ok(
      stdout.includes(
        '5 payment cards · 1 graduated · 1 new-design? · 1 upgradeable · 1 missing art · 1 not in DB',
      ),
      stdout,
    );

    // Tier-specific next steps (upgradeable = strong, new-design = soft).
    assert.match(stdout, /Upgradeable.*beats the current issuer-site art/s);
    assert.match(stdout, /New design\?.*banks refresh designs/s);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('--json exposes art_status + local_sha256 and tier counts', async () => {
  const { root, dbFile } = await fourTierFixture();
  try {
    const { code, stdout } = runCli(['--passes-dir', root, '--json'], { OPENCARD_DB_FILE: dbFile });
    assert.equal(code, 0, stdout);
    const out = JSON.parse(stdout);

    const grad = out.walletCards.find((w) => w.matchedId === 'nw-aurora-signature');
    assert.equal(grad.art_status, 'graduated');
    assert.equal(grad.local_sha256, GRAD_SHA);
    assert.match(grad.local_sha256, /^[a-f0-9]{64}$/);

    assert.equal(out.walletCards.find((w) => w.matchedId === 'nw-cobalt-everyday').art_status, 'new-design');
    assert.equal(out.walletCards.find((w) => w.matchedId === 'nw-borealis-platinum').art_status, 'upgradeable');
    assert.equal(out.walletCards.find((w) => w.matchedId === 'nw-nimbus-rewards').art_status, 'missing');

    assert.equal(out.summary.graduated, 1);
    assert.equal(out.summary.newDesign, 1);
    assert.equal(out.summary.upgradeable, 1);
    assert.equal(out.summary.missingArt, 1);
    assert.equal(out.summary.notInDb, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('--export prints sha256 + a paste-ready provenance block for a matched card', async () => {
  const { root, dbFile } = await fourTierFixture();
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-exp-'));
  try {
    const { code, stdout } = runCli(['--passes-dir', root, '--export', dest], { OPENCARD_DB_FILE: dbFile });
    assert.equal(code, 0, stdout);
    assert.ok(stdout.includes(`sha256: ${GRAD_SHA}`), stdout);
    assert.match(stdout, /"provenance": \{/);
    assert.match(stdout, /"source": "apple-pay"/);
    assert.ok(stdout.includes(`"source_sha256": "${GRAD_SHA}"`), stdout);
    assert.match(stdout, /"width": 10/);
    assert.match(stdout, /"height": 6/);
    assert.match(stdout, /"exported_at": "\d{4}-\d{2}-\d{2}"/);
    // The PNG landed on disk.
    await fs.access(path.join(dest, 'nw-aurora-signature.png'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(dest, { recursive: true, force: true });
  }
});

test('--repo writes image.provenance into the card JSON (and refuses when it is missing)', async () => {
  const { root, dbFile } = await fourTierFixture();
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-repo-'));
  try {
    // Minimal opencard-db checkout shape.
    await fs.writeFile(path.join(repo, 'schema.json'), '{}');
    await fs.mkdir(path.join(repo, 'images'), { recursive: true });
    await fs.mkdir(path.join(repo, 'data', 'nw'), { recursive: true });
    // The graduated card's data file exists; the others do NOT (refusal path).
    const cardPath = path.join(repo, 'data', 'nw', 'aurora-signature.json');
    const original = {
      id: 'nw-aurora-signature',
      name: 'Aurora Signature Card',
      annual_fee: { amount: 95, currency: 'USD' },
      image: { attribution: '© Northwind Bank (Apple Pay digital card art)' },
    };
    await fs.writeFile(cardPath, JSON.stringify(original, null, 2) + '\n');

    const { code, stdout } = runCli(['--passes-dir', root, '--export', '--repo', repo], {
      OPENCARD_DB_FILE: dbFile,
    });
    assert.equal(code, 0, stdout);

    // PNG dropped into images/<id>.png.
    await fs.access(path.join(repo, 'images', 'nw-aurora-signature.png'));

    // Provenance written; other fields preserved; local_path added for coherence.
    const written = JSON.parse(await fs.readFile(cardPath, 'utf-8'));
    assert.equal(written.name, 'Aurora Signature Card');
    assert.deepEqual(written.annual_fee, { amount: 95, currency: 'USD' });
    assert.equal(written.image.attribution, '© Northwind Bank (Apple Pay digital card art)');
    assert.equal(written.image.provenance.source, 'apple-pay');
    assert.equal(written.image.provenance.source_sha256, GRAD_SHA);
    assert.equal(written.image.provenance.width, 10);
    assert.equal(written.image.provenance.height, 6);
    assert.equal(written.image.local_path, 'images/nw-aurora-signature.png');
    // Trailing newline preserved, 2-space indent.
    const rawWritten = await fs.readFile(cardPath, 'utf-8');
    assert.ok(rawWritten.endsWith('}\n'), 'trailing newline');
    assert.ok(rawWritten.includes('\n  "id"'), '2-space indent');

    // A matched card whose data JSON is absent is refused, not created.
    assert.match(stdout, /provenance not written: card JSON not found/);
    await assert.rejects(fs.access(path.join(repo, 'data', 'nw', 'cobalt-everyday.json')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});
