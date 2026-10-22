import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import releasePlease from 'release-please';
import { buildStrategy } from 'release-please/build/src/factory.js';
import { PullRequestBody } from 'release-please/build/src/util/pull-request-body.js';
import { Version } from 'release-please/build/src/version.js';
const { Manifest } = releasePlease;

// Match the release-please version bundled in the pinned v5 action.
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
