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

test('table: header, one aligned row per card, summary, and ignored-count line', async () => {
  const { root, dbFile } = await threeCardFixture();
  try {
    const { code, stdout } = runCli(['--passes-dir', root], { OPENCARD_DB_FILE: dbFile });
    assert.equal(code, 0, stdout);

    // No banner: output starts with the table header.
    assert.ok(!/opencard-export v\d/.test(stdout), 'no version banner');
    assert.match(stdout.trimStart(), /^NAME\s+ISSUER\s+MATCH\s+DATA\s+STATUS\n/);

    // Aurora has DB art but this export is not in its lineage → art wanted.
    assert.match(
      stdout,
      /Aurora Signature\s+Northwind Bank\s+nw-aurora-signature\s+6\/6\s+art wanted/,
    );
    // Cobalt is in the DB but has no art at all → also art wanted.
    assert.match(
      stdout,
      /Cobalt Everyday\s+Northwind Bank\s+nw-cobalt-everyday\s+2\/6\s+art wanted/,
    );
    // Nimbus is not in the DB → dash DB cells, explicit status.
    assert.match(stdout, /Nimbus Rewards\s+Riverside CU\s+-\s+-\s+not in database/);

    // One summary line, non-zero segments only.
    assert.ok(
      stdout.includes('3 payment cards: 2 art wanted, 1 not in database'),
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

    // Hints: one command line, one issue-form line, nothing else.
    assert.ok(
      stdout.includes('To contribute card art (2 cards), run: npx opencard-export --export'),
      stdout,
    );
    assert.ok(
      stdout.includes(
        'To request a missing card: https://github.com/thedavidweng/opencard-db/issues/new?template=add-card.yml',
      ),
      stdout,
    );
    assert.ok(!/Next steps:/.test(stdout), 'no Next steps section');

    // No copyright notice on a scan (nothing was copied).
    assert.ok(!/copyright/i.test(stdout), stdout);
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
    assert.ok(stdout.includes('No Apple Pay payment cards in Wallet.'), stdout);
    assert.ok(
      stdout.includes(
        'Ignored 2 non-payment passes (loyalty cards, tickets, boarding passes).',
      ),
      stdout,
    );
    assert.match(stdout, /Add a card to Apple Pay and rerun/);
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
    assert.equal(out.summary.upToDate, 0);
    assert.equal(out.summary.artWanted, 2);
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
    // same art: the DB's apple-pay source_sha256 IS this wallet card's export.
    image: { local_path: 'images/nw-aurora-signature.webp', provenance: { source: 'apple-pay', source_sha256: GRAD_SHA } },
  },
  {
    id: 'nw-cobalt-everyday',
    name: 'Cobalt Everyday Card',
    issuer: 'Northwind Bank',
    country: 'nw',
    annual_fee: { amount: 0, currency: 'USD' },
    rewards: { base_rate: { points_per_dollar: 2 } },
    // different art: DB art is apple-pay but a different sha.
    image: { local_path: 'images/nw-cobalt-everyday.webp', provenance: { source: 'apple-pay', source_sha256: OTHER_SHA } },
  },
  {
    id: 'nw-borealis-platinum',
    name: 'Borealis Platinum Card',
    issuer: 'Northwind Bank',
    country: 'nw',
    annual_fee: { amount: 0, currency: 'USD' },
    rewards: { base_rate: { points_per_dollar: 1 } },
    // issuer art: DB art came from the issuer site.
    image: { url: 'https://issuer.example/borealis.png', provenance: { source: 'issuer-site', source_sha256: OTHER_SHA } },
  },
  {
    id: 'nw-nimbus-rewards',
    name: 'Nimbus Rewards Card',
    issuer: 'Northwind Bank',
    country: 'nw',
    annual_fee: { amount: 0, currency: 'USD' },
    rewards: { base_rate: { points_per_dollar: 1 } },
    // no art: no image at all.
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

test('table: the three statuses cover all art situations', async () => {
  const { root, dbFile } = await fourTierFixture();
  try {
    const { code, stdout } = runCli(['--passes-dir', root], { OPENCARD_DB_FILE: dbFile });
    assert.equal(code, 0, stdout);

    // Same art already in the DB → up to date; every other matched case
    // (different apple-pay art, issuer art, no art) → art wanted.
    assert.match(stdout, /nw-aurora-signature\s+3\/6\s+up to date/);
    assert.match(stdout, /nw-cobalt-everyday\s+3\/6\s+art wanted/);
    assert.match(stdout, /nw-borealis-platinum\s+3\/6\s+art wanted/);
    assert.match(stdout, /nw-nimbus-rewards\s+2\/6\s+art wanted/);
    assert.match(stdout, /Mystery Card\s+Unknown CU\s+-\s+-\s+not in database/);

    // Summary, non-zero segments only.
    assert.ok(
      stdout.includes(
        '5 payment cards: 3 art wanted, 1 not in database, 1 up to date',
      ),
      stdout,
    );

    // No tier jargon anywhere in the report.
    assert.ok(!/graduated/.test(stdout), stdout);
    assert.ok(!/upgradeable/.test(stdout), stdout);
    assert.ok(!/new design/.test(stdout), stdout);
    assert.ok(
      stdout.includes('To contribute card art (3 cards), run: npx opencard-export --export'),
      stdout,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('--json exposes status, db_art, same_art, local_sha256 and state counts', async () => {
  const { root, dbFile } = await fourTierFixture();
  try {
    const { code, stdout } = runCli(['--passes-dir', root, '--json'], { OPENCARD_DB_FILE: dbFile });
    assert.equal(code, 0, stdout);
    const out = JSON.parse(stdout);

    const same = out.walletCards.find((w) => w.matchedId === 'nw-aurora-signature');
    assert.equal(same.status, 'up-to-date');
    assert.equal(same.db_art, 'apple-pay');
    assert.equal(same.same_art, true);
    assert.equal(same.local_sha256, GRAD_SHA);
    assert.match(same.local_sha256, /^[a-f0-9]{64}$/);

    const cobalt = out.walletCards.find((w) => w.matchedId === 'nw-cobalt-everyday');
    assert.equal(cobalt.status, 'art-wanted');
    assert.equal(cobalt.db_art, 'apple-pay');
    assert.equal(cobalt.same_art, false);
    const borealis = out.walletCards.find((w) => w.matchedId === 'nw-borealis-platinum');
    assert.equal(borealis.status, 'art-wanted');
    assert.equal(borealis.db_art, 'issuer');
    const nimbus = out.walletCards.find((w) => w.matchedId === 'nw-nimbus-rewards');
    assert.equal(nimbus.status, 'art-wanted');
    assert.equal(nimbus.db_art, 'none');
    const mystery = out.walletCards.find((w) => w.matchedId === null);
    assert.equal(mystery.status, 'not-in-database');
    assert.equal(mystery.db_art, null);

    assert.equal(out.summary.upToDate, 1);
    assert.equal(out.summary.artWanted, 3);
    assert.equal(out.summary.notInDb, 1);
    // No tier jargon in the machine output either.
    assert.ok(!stdout.includes('graduated'), stdout);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('--export prints sha256 + a paste-ready provenance block for a matched card', async () => {
  const { root, dbFile } = await fourTierFixture();
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-exp-'));
  const UPGR_SHA = sha256(UPGR_PNG);
  try {
    const { code, stdout } = runCli(['--passes-dir', root, '--export', dest], { OPENCARD_DB_FILE: dbFile });
    assert.equal(code, 0, stdout);
    // The issuer-art card carries the contribution package.
    assert.ok(stdout.includes(`sha256: ${UPGR_SHA}`), stdout);
    assert.match(stdout, /"provenance": \{/);
    assert.match(stdout, /"source": "apple-pay"/);
    assert.ok(stdout.includes(`"source_sha256": "${UPGR_SHA}"`), stdout);
    assert.match(stdout, /"width": 30/);
    assert.match(stdout, /"height": 18/);
    assert.match(stdout, /"exported_at": "\d{4}-\d{2}-\d{2}"/);
    // The already-contributed card is exported but flagged as a duplicate:
    // no provenance snippet, a plain note instead.
    assert.match(stdout, /nw-aurora-signature\.png/);
    assert.ok(
      stdout.includes('the database already has this exact art; nothing new to contribute'),
      stdout,
    );
    assert.ok(!stdout.includes(`"source_sha256": "${GRAD_SHA}"`), stdout);
    // The unmatched card points at the request-a-card form.
    assert.ok(
      stdout.includes('not in the database; request the card first:'),
      stdout,
    );
    // The PNGs landed on disk.
    await fs.access(path.join(dest, 'nw-aurora-signature.png'));
    await fs.access(path.join(dest, 'nw-borealis-platinum.png'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(dest, { recursive: true, force: true });
  }
});

test('--repo writes image.provenance into the card JSON (and refuses when it is missing)', async () => {
  const { root, dbFile } = await fourTierFixture();
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'oce-repo-'));
  const UPGR_SHA = sha256(UPGR_PNG);
  try {
    // Minimal opencard-db checkout shape.
    await fs.writeFile(path.join(repo, 'schema.json'), '{}');
    await fs.mkdir(path.join(repo, 'images'), { recursive: true });
    await fs.mkdir(path.join(repo, 'data', 'nw'), { recursive: true });
    // The issuer-art card's data file exists (write path); the same-art
    // card's file exists too (must be left untouched); cobalt has NO file
    // (refusal path).
    const upgrPath = path.join(repo, 'data', 'nw', 'borealis-platinum.json');
    await fs.writeFile(
      upgrPath,
      JSON.stringify(
        {
          id: 'nw-borealis-platinum',
          name: 'Borealis Platinum Card',
          annual_fee: { amount: 0, currency: 'USD' },
          image: { attribution: '© Northwind Bank (Apple Pay digital card art)' },
        },
        null,
        2,
      ) + '\n',
    );
    const gradPath = path.join(repo, 'data', 'nw', 'aurora-signature.json');
    const gradOriginal =
      JSON.stringify({ id: 'nw-aurora-signature', name: 'Aurora Signature Card' }, null, 2) +
      '\n';
    await fs.writeFile(gradPath, gradOriginal);

    const { code, stdout } = runCli(['--passes-dir', root, '--export', '--repo', repo], {
      OPENCARD_DB_FILE: dbFile,
    });
    assert.equal(code, 0, stdout);

    // PNGs dropped into images/<id>.png.
    await fs.access(path.join(repo, 'images', 'nw-borealis-platinum.png'));
    await fs.access(path.join(repo, 'images', 'nw-aurora-signature.png'));

    // Provenance written; other fields preserved; local_path added for coherence.
    const written = JSON.parse(await fs.readFile(upgrPath, 'utf-8'));
    assert.equal(written.name, 'Borealis Platinum Card');
    assert.deepEqual(written.annual_fee, { amount: 0, currency: 'USD' });
    assert.equal(written.image.attribution, '© Northwind Bank (Apple Pay digital card art)');
    assert.equal(written.image.provenance.source, 'apple-pay');
    assert.equal(written.image.provenance.source_sha256, UPGR_SHA);
    assert.equal(written.image.provenance.width, 30);
    assert.equal(written.image.provenance.height, 18);
    assert.equal(written.image.local_path, 'images/nw-borealis-platinum.png');
    assert.match(stdout, /provenance written to .*borealis-platinum\.json/);
    // Trailing newline preserved, 2-space indent.
    const rawWritten = await fs.readFile(upgrPath, 'utf-8');
    assert.ok(rawWritten.endsWith('}\n'), 'trailing newline');
    assert.ok(rawWritten.includes('\n  "id"'), '2-space indent');

    // The same-art card's JSON is not rewritten: the DB already carries this
    // exact provenance (and rewriting could clobber an alternate-sha anchor).
    assert.equal(await fs.readFile(gradPath, 'utf-8'), gradOriginal);
    assert.ok(
      stdout.includes('the database already has this exact art; nothing new to contribute'),
      stdout,
    );

    // A matched card whose data JSON is absent is refused, not created.
    assert.match(stdout, /provenance not written: card JSON not found/);
    await assert.rejects(fs.access(path.join(repo, 'data', 'nw', 'cobalt-everyday.json')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('--no-remote with payment cards: dash columns, plain count, no hints', async () => {
  const { root } = await threeCardFixture();
  try {
    const { code, stdout, stderr } = runCli(['--passes-dir', root, '--no-remote']);
    assert.equal(code, 0, stdout);
    // Every card renders with dash DB columns.
    assert.match(stdout, /Aurora Signature\s+Northwind Bank\s+-\s+-\s+-/);
    // Summary is the plain count, with no state segments.
    assert.ok(stdout.includes('3 payment cards\n'), stdout);
    assert.ok(!stdout.includes('not in database'), stdout);
    // No hints: match state is unknown, so neither the export command nor the
    // request-a-card form may be suggested.
    assert.ok(!stdout.includes('To contribute card art'), stdout);
    assert.ok(!stdout.includes('To request a missing card'), stdout);
    // The note lands on stderr, keeping stdout clean.
    assert.match(stderr, /database comparison skipped/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
