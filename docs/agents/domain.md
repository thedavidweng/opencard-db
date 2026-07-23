# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (ubiquitous language / glossary).
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **Product specs (PRDs)** — GitHub Issues labelled `ready-for-agent` (or the active feature issue). Canonical v1 spec: [Spec: OpenCard DB v1 production system](https://github.com/thedavidweng/opencard-db/issues/10). Specs are **not** stored as Superpowers files under `docs/superpowers/`.

If CONTEXT/ADRs don't exist for a topic, **proceed silently** and create them via domain-modeling when terms or decisions crystallise. Prefer the glossary vocabulary over synonyms.

## File structure

Single-context repo:

```
/
├── CONTEXT.md                 ← glossary (lazy if empty project)
├── docs/
│   ├── adr/                   ← architecture decision records
│   └── agents/                ← issue tracker, triage, domain consumer rules
├── data/{us,ca,cn}/           ← Card JSON (system of record)
├── schema.json
├── scripts/
├── worker/
└── tests/
```

Product specs live as **GitHub Issues**, not as markdown under docs/.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Prefer design terms: **Card**, **Card Id**, **Network Tier**, **Issuer**, **Benefit Source**, **Source**, **Last Verified**.

## Flag ADR conflicts

If your output contradicts an existing ADR or the product spec issue, surface it explicitly rather than silently overriding.

## Cost and hosting constraints

Prefer Cloudflare Free only. No paid Workers/KV features. Official free API is rate-limited; production traffic must self-host.
