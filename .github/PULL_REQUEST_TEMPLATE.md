<!--
═══════════════════════════════════════════════════════════
  PR TITLE (required) — copy one line into the title box above

  New card:     Add card: us-your-card-slug
  Update card:  Update card: us-your-card-slug
  Not a card:   docs: short summary   OR   ci: short summary

  Rules:
  • Use lowercase country + slug: us / ca / cn
  • One card per PR when adding or updating card data
  • Example: Add card: us-chase-sapphire-preferred
═══════════════════════════════════════════════════════════
-->

## What kind of change is this?

- [ ] **New card** (add a file under `data/us/`, `data/ca/`, or `data/cn/`)
- [ ] **Update existing card**
- [ ] **Not a card** (docs / CI / code) — skip the Card form below

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
- **Last verified (YYYY-MM-DD):** 2026-07-24

### 3. Card image (pick one)

- [ ] **A. Official image URL** (preferred)
  - **Image URL:** https://www.example-bank.com/cardart/example.png
- [ ] **B. Upload a local file in this PR**
  1. Add the file under `images/` named like `us-example-card.png` (or `.jpg`)
  2. CI will convert it to optimized WebP automatically
  - **Local path after upload:** `images/us-example-card.png`
- [ ] **C. No image yet** (reviewers may still merge; `image.url` can be `null`)

<!-- Optional: paste / drop a preview image here (GitHub upload). This is only a preview — prefer A or B above for the database. -->


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
