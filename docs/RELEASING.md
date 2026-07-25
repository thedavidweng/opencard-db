# Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please). Nobody writes release notes or edits a changelog by hand. The only human step is approving and merging one PR.

## How it works

Every merge to `main` uses a Conventional Commits title (`card(add):`, `card(update):`, `feat:`, `fix:`, ...). The `release-please.yml` workflow parses those commits and maintains a rolling **release PR** that always shows the next version and its changelog. Merging that PR cuts the release:

1. release-please creates the tag and the GitHub Release, with notes generated from the changelog.
2. The workflow attaches the committed `exports/` files to the Release as download assets. They are byte-identical to what jsDelivr serves at the new tag.
3. When npm publishing is enabled (see below), a new `opencard-export` version is published to npm with provenance.

The release PR also carries a `chore(exports): refresh generated exports for release` commit. The workflow rebuilds `exports/` on the PR branch after every update, so the tagged commit always serves current data on `cdn.jsdelivr.net/gh/thedavidweng/opencard-db@<tag>/exports/*`. The old pre-tag manual refresh is gone.

There are two release units, versioned independently from the same release PR:

| Unit | Path | Tag format | Published as |
| --- | --- | --- | --- |
| Data catalog | `.` | `vX.Y.Z` | GitHub Release + jsDelivr tag pin |
| CLI | `packages/opencard-export` | `opencard-export-vX.Y.Z` | npm (`opencard-export`) |

Commits touching `packages/opencard-export` count toward the CLI version only; everything else counts toward the catalog.

## Version bumps

Standard release-please semantics:

- `feat:` bumps the minor version.
- `fix:`, `card(add):`, `card(update):` and other types bump the patch version.
- A `BREAKING CHANGE:` footer or a `!` after the type (`feat!:`) bumps the major version.

To force a specific version, put `Release-As: 1.0.0` on its own line in a commit body, or edit the version in the release PR before merging.

## One-time setup

Two pieces need human setup once. Both are optional to start; the workflow degrades gracefully without them.

**1. `RELEASE_PLEASE_TOKEN` secret (required for unattended operation).** PRs opened with the default Actions token do not trigger CI, so the release PR's required checks would sit in "expected" forever and only an admin merge could land it. Create a fine-grained PAT scoped to this repository with read/write on Contents and Pull requests, then save it as the `RELEASE_PLEASE_TOKEN` repository secret. The exports refresh workflow uses the same secret for the same reason.

**2. npm trusted publishing (required only for CLI publishing).** The first `opencard-export` publish must be manual: `cd packages/opencard-export && npm login && npm publish --access public`. After that, open `https://www.npmjs.com/package/opencard-export/access`, add a Trusted Publisher pointing at this repository and the `release-please.yml` workflow, and set the repository variable `NPM_PUBLISH` to `true`. From then on the workflow publishes via OIDC, with no npm token stored anywhere.

## Notes for maintainers

- Branch protection dismisses stale approvals, and the release PR is force-updated on every merge to `main`. Approve and merge it in one sitting; an approval left overnight will be dismissed by the next card merge.
- Do not push manual commits to the release PR branch. release-please recreates the branch from `main` on its next run and drops them (the exports refresh commit is re-added automatically; yours will not be).
- Emergency manual path if the automation is down: build exports, tag, then `gh release create vX.Y.Z exports/*.json exports/cards.csv exports/cards.yaml --generate-notes`. Fix the manifest version in `.release-please-manifest.json` afterwards if release-please did not do the tagging.
- Bump behavior, changelog sections, and the PR text live in `release-please-config.json`. Current versions live in `.release-please-manifest.json`.
