# Reviewing data PRs — the trust model

OpenCard DB's card data is only as trustworthy as its review. This page is for
**maintainers and reviewers**. Read it before approving any PR that adds or
changes card data.

## Green CI means well-formed, not true

Our CI checks the **form** of a contribution, not the **truth** of it. A PR can
be perfectly green and still contain fabricated numbers, a wrong issuer, or a
signup bonus that never existed. Automated checks cannot open the bank's website
and confirm that "3x on dining" is real — a human must.

So the mental model is:

> **Green CI = the data is well-formed and internally consistent.
> It does NOT mean the data is correct.**

Branch protection requires **1 human review** (admins may bypass for
maintainer-authored batches — see below). That review is the point where truth
gets checked. The machine's job is to hand you the evidence.

## What the machine checks (so you don't have to)

| Check | What it proves | What it does **not** prove |
| --- | --- | --- |
| **Schema** (`npm run validate`) | Every required field is present and correctly typed. | That the values are real. |
| **Semantic lints** | Issuer is registered, network tier is atomic and allow-listed, rates aren't fraction-encoded, dates aren't in the future, fee currency matches the market, `image.url` is not a stock photo / social banner / OG image / award badge, and two Card Ids do not share a URL unless they are in `SHARED_ART_FAMILIES`. | That the rate/fee/date is the one on the bank's page, or that a unique `image.url` actually depicts this product. |
| **Domain allowlist** (anti-fabrication) | Every `official_url` / `sources[]` host belongs to the card's issuer or a known co-brand domain (`data/issuers.json` → `domains`). A source on a domain the issuer doesn't own is an **error**. | That the page at that URL actually documents the claim. |
| **Update diff flags** (anti-vandalism) | For `card(update)` PRs, a field-level diff (old → new) of key fields, with **warn** flags on high-impact changes (fee jump >$100 or to/from null, network / tier flip, `official_url` host change, status → discontinued) and a hard **error** if `issuer_id` changes. | Which of the two values is the correct one. |
| **Labels / Form check** | The PR is classified and the beginner form is filled in. | Anything about the data's accuracy. |

These are **signals**, not gates. Most truth heuristics are **warn-level on
purpose**: banks block bots, official pages move, and false positives must never
brick a legitimate PR. The one hard truth-gate is `issuer_id` changing on an
update — issuer identity should never silently change, so that is an error.

## What the human must check before merging

The reviewer owns everything the machine can't see. For any card add/update:

1. **Open the cited official page(s)** in `official_url` / `sources[]`. Confirm
   they are the issuer's own site (or a legitimate co-brand/servicing domain),
   load, and are about **this** card.
2. **Verify the identity fields against that page:** `name`, `issuer` /
   `issuer_id`, `network`, `network_tier`, `annual_fee`, `fx_fee`. These are the
   fields a fabricated or vandalized card gets wrong.
3. **Confirm the sources actually document the claims** — that the rewards
   rates, signup bonus, and benefits in the JSON appear on the linked pages. A
   URL that merely *exists* is not provenance; it has to *say* what the card
   claims.
4. **On updates, read the diff table** in the sticky comment. For every
   high-impact flag, confirm the new value on the official page. Treat an
   `issuer_id` change as "this is a different card" unless proven otherwise.
5. **Watch for external contributors.** PRs from non-maintainers carry a
   `needs-verification` label and a reviewer note — do not merge on green CI
   alone.

If you can't verify a claim, ask the contributor for the exact source, or leave
the PR open. Unverifiable data should not land.

## Auto-merge policy

- **Never** arm auto-merge on an unreviewed external data PR. Green CI is not a
  substitute for a human reading the sources.
- Auto-merge is only acceptable for **maintainer-authored batches** (e.g. a
  scripted backfill the maintainer has already vetted), and even then a second
  maintainer's review is preferred for data changes.
- Trust flows from the reviewer, not the pipeline.

## The ruleset in plain terms

- The protected branch requires **1 approving review** before merge.
- **Admins may bypass** the requirement. Use that power only for
  maintainer-authored, already-vetted changes — never to shortcut review of
  someone else's data.
- CI status checks (validate, Labels, Form check) must pass, but remember they
  gate **form**, not **truth**.

---

See also: [CONTRIBUTING.md](../CONTRIBUTING.md) ·
[domain rules](contributing.md) · [validation FAQ](faq.md)
