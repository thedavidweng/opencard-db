<!--
═══════════════════════════════════════════════════════════
  PR TITLE (required) — put ONE line in the title box above
  One Conventional Commits system for every PR:

  ── Cards (type `card` + scope) ──
  New card:     card(add): us-your-card-slug
  Update card:  card(update): us-your-card-slug

  ── Everything else ──
  feat: short summary
  fix: short summary
  docs: short summary
  ci: short summary
  chore: short summary
  (also: refactor / test / build / perf / style / revert)
  Optional scope: feat(pr-checks): …   Breaking: feat!: …

  Rules for cards:
  • Lowercase country + slug: us / ca / cn
  • One card per PR
  • Example: card(add): us-chase-sapphire-preferred
  • Legacy Add/Update card: … still accepted
═══════════════════════════════════════════════════════════
-->

> New here? See [CONTRIBUTING.md](CONTRIBUTING.md) for the three ways to add a card (no-tools issue form, browser-only, or local clone).

## What kind of change is this?

- [ ] **New card** (add a file under `data/us/`, `data/ca/`, or `data/cn/`)
- [ ] **Update existing card**
- [ ] **Not a card** (docs / CI / code) — skip the Card form below; use a Conventional Commits title

---

## Card form

> Fill every line that starts with `**…:**`.  
> Keep the backticks. Replace only the example values.  
> If something is unknown, write `unknown` (do not delete the line).

### 1. Identity

- **Card ID:** `us-example-card`
- **Country:** `us` <!-- us | ca | cn -->
- **File path:** `data/us/example-card.json`
- **Display name:** Example Card Name

### 2. Official sources (required)

- **Product page:** https://www.example-bank.com/cards/example
- **Terms / benefits page:** https://www.example-bank.com/cards/example/terms
- **Last verified (YYYY-MM-DD):** YYYY-MM-DD

### 3. Card image (pick the best you can)

<details><summary>Advanced: Apple Pay card art</summary>

Graduation bar for local mirrors: **Apple Pay** digital wallet art (`cardBackgroundCombined@2x.png` → CI **lossless WebP** at native size). Prefer this over random screenshots or unknown crops. See `docs/research/apple-pay-card-art.md`.

- [ ] **A. Official issuer image URL** (stable product-page art)
  - **Image URL:** https://www.example-bank.com/cardart/example.png
- [ ] **B. Apple Pay extract (preferred local mirror — “graduation-level”)**
  1. On a Mac with the card in Wallet, copy  
     `~/Library/Passes/Cards/*.pkpass/cardBackgroundCombined@2x.png`
  2. Rename to `{card-id}.png` (e.g. `us-example-card.png`) and add under `images/`
  3. CI converts to **lossless WebP** (no 800px downscale)
  4. Set `image.local_path` to `images/us-example-card.webp` after CI
  5. **Attribution:** `© Issuer (Apple Pay digital card art)`
- [ ] **C. Other local upload** (marketing PNG/JPG when no Apple Pay / official URL)
  1. Add under `images/` named like `us-example-card.png`
  2. CI still emits lossless WebP — note the source in Notes
  - **Local path after upload:** `images/us-example-card.webp`
- [ ] **D. No image yet** (reviewers may still merge; `image.url` can be `null`)

- [ ] **TODO (optional follow-up):** If this PR ships without an Apple Pay face, open a follow-up when someone who holds the card can extract it

</details>

#### 卡面预览 / Card preview (optional) — drag an image here, it renders inline


### 4. Quick facts (helps reviewers)

- **Issuer:** Example Bank
- **Network:** `visa` <!-- visa | mastercard | amex | discover | unionpay | jcb | other -->
- **Network tier:** `signature` <!-- e.g. infinite, signature, world_elite, diamond, none -->
- **Annual fee:** `95` **Currency:** `USD`
- **Signup bonus (short):** e.g. 60,000 points after $4,000 in 3 months — or `unknown`

### 5. Checklist

- [ ] I copied `templates/card.template.json` → `data/{country}/{slug}.json` (or edited an existing file)
- [ ] `id` in the JSON equals `{country}-{slug}` and matches the file path
- [ ] `sources` lists the official URLs above
- [ ] `last_verified` is the date I checked
- [ ] Issuer and Network are separate fields (product names are NOT in `network_tier`)
- [ ] I understand card artwork stays bank copyright

---

## Notes for reviewers

_(Anything incomplete, seasonal offers, dual-network 双标 details, etc.)_

_

---

## For non-card PRs only

**Summary:** 
