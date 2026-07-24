# Clue datasets (not Sources)

Files here are **discovery clues** from third-party open card lists:

| Clue | Typical size | Role |
|------|--------------|------|
| npm [`credit-card-db-api`](https://www.npmjs.com/package/credit-card-db-api) | ~54 | Wishlist / name hints |
| GitHub [`andenacitelli/credit-card-bonuses-api`](https://github.com/andenacitelli/credit-card-bonuses-api) | ~175 | Wishlist / offer hints |

**Rules (see Spec #10 / ADR-0001):**

1. Never put third-party pages in a Card’s `sources` array.
2. Every Card must be filled from **official issuer / network** product or terms pages.
3. Prefer one Card per PR; set `last_verified` to the day you checked the official page.
4. If the clue URL is a NerdWallet / affiliate redirect, open the issuer site yourself.

Regenerate:

```bash
# optional local dumps
mkdir -p clues/raw
# npm pack / curl into clues/raw/*.json if offline

node --experimental-strip-types scripts/clues/build-wishlist.ts
```

Outputs:

- `clues/wishlist.json` — full union + coverage vs `data/`
- `clues/missing-active-consumer.json` — active personal cards not yet in the repo
