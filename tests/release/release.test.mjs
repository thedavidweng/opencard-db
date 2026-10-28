import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import releasePlease from 'release-please';
import { parseConventionalCommits } from 'release-please/build/src/commit.js';
import { buildStrategy } from 'release-please/build/src/factory.js';
import { PullRequestBody } from 'release-please/build/src/util/pull-request-body.js';
import { Version } from 'release-please/build/src/version.js';
const { Manifest } = releasePlease;

const github = {
  repository: { owner: 'thedavidweng', repo: 'opencard-db', defaultBranch: 'main' },
  async getFileJson(path) {
    return JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));
  },
  async getFileContentsOnBranch(path) {
    return { parsedContent: await readFile(new URL(`../../${path}`, import.meta.url), 'utf8') };
  },
};

async function strategy(path) {
  const manifest = await Manifest.fromManifest(github, 'main');
  return buildStrategy({ github, path, ...manifest.repositoryConfig[path] });
}

function mergedPR(units) {
  return {
    number: 439,
    headBranchName: 'release-please--branches--main',
    baseBranchName: 'main',
    title: units.length === 1 && !units[0].component
      ? 'chore(main): release 0.3.2'
      : 'chore: release main',
    body: new PullRequestBody(units.map(unit => ({
      ...unit, version: Version.parse(unit.version), notes: '### Bug Fixes\n\n* release regression',
    })), { useComponents: true }).toString(),
    labels: ['autorelease: pending'],
    files: [],
    sha: '0123456789abcdef0123456789abcdef01234567',
  };
}

const catalog = { component: '', version: '0.3.2' };
const cli = { component: 'opencard-export', version: '0.4.1' };

test('catalog-only merged PR creates the unprefixed catalog release', async () => {
  const root = await strategy('.');
  const releases = await root.buildReleases(mergedPR([catalog]));
  assert.deepEqual(releases.map(release => release.tag.toString()), ['v0.3.2']);
});

test('combined PR independently creates catalog and CLI tags', async () => {
  const pr = mergedPR([catalog, cli]);
  const root = await strategy('.');
  const exporter = await strategy('packages/opencard-export');
  assert.deepEqual((await root.buildReleases(pr)).map(release => release.tag.toString()), ['v0.3.2']);
  assert.deepEqual((await exporter.buildReleases(pr)).map(release => release.tag.toString()),
    ['opencard-export-v0.4.1']);
});

test('CLI-only PR cannot create a catalog release', async () => {
  const pr = mergedPR([cli]);
  const root = await strategy('.');
  const exporter = await strategy('packages/opencard-export');
  assert.deepEqual(await root.buildReleases(pr), []);
  assert.deepEqual((await exporter.buildReleases(pr)).map(release => release.tag.toString()),
    ['opencard-export-v0.4.1']);
});

test('catalog version updates preserve the actual npm package name', async () => {
  const root = await strategy('.');
  const updates = await root.buildUpdates({
    newVersion: Version.parse('0.3.2'), versionsMap: new Map(), changelogEntry: '',
  });
  const update = updates.find(update => update.path === 'package.json');
  const original = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
  const updated = JSON.parse(update.updater.updateContent(original));
  assert.equal(updated.name, 'opencard-db');
  assert.equal(updated.version, '0.3.2');
});

// The catalog release exists to ship card data. A docs-only merge must not
// reopen a catalog release PR, which is what kept happening before the `docs`
// section was hidden: release-please skips a PR only when the generated notes
// are empty, so any visible section (including Documentation) keeps one alive.
// `exclude-paths` cannot express this, because it only drops commits whose
// every changed file sits under an excluded directory prefix.
const latestCatalog = { tag: { version: Version.parse('0.4.1'), toString: () => 'v0.4.1' }, sha: 'd'.repeat(40) };

function docsOnlyCommits(extraCommits) {
  return parseConventionalCommits([
    { sha: '1'.repeat(40), message: 'docs(local-worker): correct the cf dev persistence instructions (#614)\n', files: ['docs/agents/local-worker.md'] },
    { sha: '2'.repeat(40), message: 'docs: fix the CDN example tag in README (#630)\n', files: ['README.md'] },
    ...extraCommits,
  ]);
}

test('docs-only merges do not open a catalog release PR', async () => {
  const root = await strategy('.');
  // The exact commit shape that reopened the draft twice: two docs commits
  // alongside hidden chore/test commits.
  const pr = await root.buildReleasePullRequest(docsOnlyCommits([
    { sha: '3'.repeat(40), message: 'chore(deps-dev): bump wrangler in /worker (#618)\n', files: ['worker/package.json'] },
    { sha: '4'.repeat(40), message: 'test(release): run the release fixture at the bundled version (#616)\n', files: ['tests/release/release.test.mjs'] },
  ]), latestCatalog);
  assert.equal(pr, undefined);
});

test('a docs commit outside docs/ also does not open a catalog release PR', async () => {
  const root = await strategy('.');
  const pr = await root.buildReleasePullRequest(parseConventionalCommits([
    { sha: '5'.repeat(40), message: 'docs: fix the CDN example tag in README (#630)\n', files: ['README.md'] },
  ]), latestCatalog);
  assert.equal(pr, undefined);
});

test('hiding docs does not suppress real catalog releases', async () => {
  const root = await strategy('.');
  const card = { sha: '6'.repeat(40), message: 'card(update): ca-rbc-ion-plus-visa (#611)\n', files: ['data/cards/ca/rbc-ion-plus-visa.json'] };
  const docs = { sha: '7'.repeat(40), message: 'docs(local-worker): note x (#614)\n', files: ['docs/agents/local-worker.md'] };

  const cardPr = await root.buildReleasePullRequest(parseConventionalCommits([card, docs]), latestCatalog);
  assert.equal(cardPr.version.toString(), '0.4.2');

  const featPr = await root.buildReleasePullRequest(parseConventionalCommits([
    { sha: '8'.repeat(40), message: 'feat: add a filter endpoint (#640)\n', files: ['scripts/build-exports.ts'] },
    docs,
  ]), latestCatalog);
  assert.equal(featPr.version.toString(), '0.5.0');
});
