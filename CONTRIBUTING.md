# Contributing to OpenCard DB

Card data changes are **Pull Request only** — there is no public write API. Pick the
path that matches how much tooling you want to touch. All three end in a PR that our
checks review automatically.

New here? Read the [中文快速上手指南](docs/contributing.zh-Hans.md), the
[domain rules](docs/contributing.md), and the [validation FAQ](docs/faq.md) too.
Please also follow our [Code of Conduct](CODE_OF_CONDUCT.md).

> **One card per PR.** Easier review, clearer sources, fewer conflicts.

---

## Path A — No tools (a bot writes the PR for you)

Best if you don't code and just want a card added.

1. Open a new issue and choose **"Request a card / 求收录卡片"**.
2. Fill in the country, card name, issuer, and the official product URL. Optional:
   terms URL, image URL, notes.
3. Submit. A bot parses your form and opens a **draft PR** with a scaffolded JSON
   file, then links it back on your issue.

The draft is only a starting point — the placeholder fields still need real, sourced
values before a maintainer can merge it. You (or a maintainer) can finish it right on
that PR.

## Path B — Browser only (no clone, no install)

Best if you're comfortable on github.com but don't want a local checkout. GitHub
auto-creates folders from the filename, so you never leave the browser.

1. **Fork** the repo (top-right **Fork**).
2. In your fork, click **Add file → Create new file**.
3. In the filename box, type the full path, e.g. `data/us/my-card.json`.
   Typing `data/us/` first makes GitHub create those folders for you.
4. Open [`templates/card.template.json`](templates/card.template.json) in another
   tab, copy its contents, and paste them into your new file.
5. Edit the values:
   - `id` must equal `{country}-{slug}` and match the filename
     (`data/us/my-card.json` → `"id": "us-my-card"`).
   - Set `country`, `name`, `issuer`, `issuer_id`, `network`, `network_tier`.
   - Put at least one **official** issuer/network URL in `sources` and `official_url`.
   - Set `last_verified` to today's date (`YYYY-MM-DD`).
   - See the [domain rules](docs/contributing.md) so issuer/network/tier go in the
     right fields.
6. Click **Commit new file** (commit to a new branch), then **Create pull request**.
7. Use a PR title like `card(add): us-my-card`. GitHub pre-fills the PR form — fill in
   every `**…:**` line.

If a check goes red, open the [validation FAQ](docs/faq.md) — it maps each error
message to the exact fix.

## Path C — Local clone (full tooling)

Best if you'll add several cards or want to validate before pushing.

```bash
git clone https://github.com/thedavidweng/opencard-db.git
cd opencard-db
npm ci

# Scaffold a new card (interactive, or pass flags):
npm run new:card -- --country us --slug my-card --name "My Card"

# Edit data/us/my-card.json, then:
npm run validate
npm test
npm run optimize:images   # only if you added files under images/
```

Open a PR with title `card(add): us-my-card` (or `card(update): …` when editing an
existing card) and fill in the PR form.

---

## What the checks do

| Check | Purpose |
|-------|---------|
| **Validate** | Schema + semantic lints (`npm run validate`). See the [FAQ](docs/faq.md). |
| **Labels** | Classifies the PR (`new-card`, `US`/`CA`/`CN`, …). Always green. |
| **Form check** | Verifies the PR title + form fields; posts a sticky comment listing anything to fix. |
| **Optimize Images** | Runs only if you uploaded a raster under `images/`. |

If **Form check** is red, edit **this** PR (title/body or a new commit) — don't open a
duplicate.

## Licenses

- Code: [MIT](LICENSE)
- Data you contribute: [CC BY 4.0](LICENSE-DATA)
- Card artwork: remains the issuing bank's copyright (see [`images/README.md`](images/README.md))
