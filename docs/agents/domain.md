# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **`docs/superpowers/specs/2026-07-23-opencard-db-design.md`** — locked v1 product/architecture design for OpenCard DB. Read before changing schema, API, deploy, or contribution workflow.

If any of these files don't exist, **proceed silently** (except the design spec above when working on product behavior). Don't flag absence of CONTEXT/ADRs; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md                 ← optional, lazy
├── docs/
│   ├── adr/                   ← optional ADRs
│   ├── agents/                ← issue tracker, triage, domain consumer rules
│   └── superpowers/specs/     ← design specs
├── data/{us,ca,cn}/           ← card JSON (source of truth)
├── schema.json
├── scripts/
├── worker/
└── tests/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md` when present. Prefer design-spec terms: **network tier**, **issuer**, **benefits source** (`network` | `issuer` | `co-brand`), **card id** (`{country}-{slug}`).

## Flag ADR conflicts

If your output contradicts an existing ADR or the locked design spec, surface it explicitly rather than silently overriding.

## Cost and hosting constraints

Prefer Cloudflare Free only. No paid Workers/KV features. Official free API is rate-limited; production traffic must self-host.
