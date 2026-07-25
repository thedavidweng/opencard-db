# Research: Apple Pay / Wallet as a card-face source

**Status:** research complete (no scraper shipped)  
**Date:** 2026-07-24  
**Related:** ADR 0004 (bank-owned images), Spec #10 (official URLs preferred; do not host high-res art as a primary service), `images/README.md`

## Question

Seed Cards mostly lack usable `image.url` (8/9 null; only Chase Sapphire Preferred has an issuer CDN URL). Contributors currently self-upload or link marketing art. Is Apple Pay a better path to **high-resolution digital card faces**, and can we automate acquisition?

## Short answer

**Yes for quality, no for automation.**

Apple Wallet stores issuer-approved **digital card art** (typically based on network specs ≈ **1536×969**, with Retina `@2x` assets on disk). That art is often sharper and more consistent than bank marketing pages. There is **no public Apple Pay card-art catalog API**. The only practical bulk-quality path used by the community is **local extraction from a Mac that already has the payment cards provisioned** (cards the contributor owns). Scraping Apple’s servers is not a viable product feature for OpenCard DB.

## How digital card art reaches Apple Pay

```text
Issuer design (PNG/PDF, ~1536×969, square corners, no PAN/chip/hologram)
        │
        ▼
Network TSP (Visa VTS / Mastercard MDES / Amex / …)
        │
        ├──► Apple Wallet (provisioning)
        └──► Google Wallet / other wallets
```

- Issuers submit **digital wallet art** to the payment network’s tokenization program; Apple and Google consume those assets during provisioning.
- Specs commonly cited by issuer/TSP docs: landscape **1536×969**, PNG or vector PDF, &lt; 4 MB, square corners, no physical-only elements.
- **OpenCard cannot call VTS/MDES** without issuer/processor credentials. Those APIs are the true upstream; Apple is a downstream cache on the user’s device.

## Where Apple stores payment card art (local)

| Platform | Path |
|----------|------|
| macOS | `~/Library/Passes/Cards/` |
| iOS (device FS) | `/private/var/mobile/Library/Passes/Cards/` |
| iCloud shoebox (passes; credit cards behave differently) | `…/Mobile Documents/com~apple~shoebox/UbiquitousCards/` |

Each provisioned payment card appears as a **`.pkpass`-style bundle** under `Cards/`. Community extractors consistently use:

```text
*.pkpass/cardBackgroundCombined@2x.png   # primary high-res face
*.pkpass/pass.json                       # product label / description for naming
```

Optional siblings may include `@1x` / `@3x` variants and other pass assets. Forensic notes (e.g. Sarah Edwards, OBTS) confirm Passes live under `~/Library/Passes/` on Mac and the equivalent under `/private/var/mobile/Library/Passes/` on iOS; payment-card transaction detail is mostly in `passes23.sqlite`, while **artwork is in the pass package files**.

### Contributor extract recipe (own cards only)

On a Mac that already shows the Apple Pay cards (Touch ID Mac with Wallet / Continuity as applicable):

```bash
mkdir -p ~/Desktop/opencard-faces
for d in ~/Library/Passes/Cards/*.pkpass; do
  [ -d "$d" ] || continue
  name=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('description','unknown'))" "$d/pass.json" 2>/dev/null || basename "$d")
  src="$d/cardBackgroundCombined@2x.png"
  [ -f "$src" ] || src="$d/cardBackgroundCombined.png"
  [ -f "$src" ] || continue
  # sanitize filename lightly
  safe=$(printf '%s' "$name" | tr '/:' '--')
  cp "$src" ~/Desktop/opencard-faces/"$safe.png"
done
```

Then map the file to an OpenCard **Card Id**, set `image.attribution` to the Issuer copyright, prefer converting to WebP only if mirroring under `images/`, and keep or prefer an official product-page URL when it is stable and clear enough.

**Not in scope:** jailbreak dumps, kernel exploits, or rewriting Wallet artwork on-device. Those appear in unrelated community tools and are irrelevant (and unsafe) for OpenCard.

## Remote / “scrape Apple” options

| Approach | Feasible? | Notes |
|----------|-----------|--------|
| Public Apple card-art CDN/API | **No** | No documented catalog of product artwork for third parties. |
| Automate HTTP scrape of Apple during provisioning | **No** | Requires real PAN / issuer push-provisioning; ToS and fraud risk. |
| Visa VTS / Mastercard MDES media APIs | **No for us** | Upstream of Apple art; needs licensed issuer/TSP access. |
| Google Pay Chrome autofill card metadata | **No bulk catalog** | Same TSP upstream; not a public product-art dump. |
| PayPal web Wallet card detail image | **Weak** | Manual save of small assets (e.g. `image__140.png`); needs a logged-in account that already stored the card. |
| Issuer marketing URLs | **Yes (current policy)** | Prefer in `image.url`; quality varies; some banks omit clear art. |
| Community libraries (discovery only) | **Clue only** | e.g. [ab/card-designs](https://github.com/ab/card-designs), [Cardentify](https://github.com/HarukaKinen/Cardentify) (many faces labelled `source: Apple Pay`). Same rule as other third-party DBs: never a **Source**. |

## Approaches for OpenCard DB

### A. Document + accept contributor Wallet extracts (recommended)

- Keep **official issuer URL** as first choice when the image is identifiable and stable.
- When missing/poor: allow a **local mirror** from the contributor’s own Apple Pay extract under existing `images/` policy (bank copyright, removal on request). CI stores **lossless WebP** at native @2x dimensions.
- Attribution example: `© Chase (digital card art via Apple Pay)`.
- Do **not** cite Apple or Cardentify as a Schema **Source**; Sources remain issuer/network product or terms URLs.

**Pros:** Highest practical quality; matches community practice; no Apple ToS scrape; fits ADR 0004.  
**Cons:** Coverage only for cards someone owns and extracts; digital art may differ from plastic marketing photos.

### B. Prefer issuer URLs only; ignore Wallet art

**Pros:** Simplest legally/operationally; already implemented (Chase seed).  
**Cons:** Leaves most Cards on the generic placeholder; marketing art often worse than Wallet digital art.

### C. Build an automated Apple/PayPal scraper or host a mirrored art CDN

**Pros:** None that survive Spec #10 / ADR 0004.  
**Cons:** No public API; ToS/copyright; Spec explicitly avoids hosting high-res official artwork as a primary service; map out-of-scope already excludes bank scraping as primary data.

## Recommendation

1. **Do not implement Apple Pay scraping** (remote or credentialed provisioning automation).
2. **Treat Apple Wallet local extract as a documented contributor workflow** for high-quality optional mirrors.
3. **Keep** `image.url` preference for official issuer product-page art when adequate.
4. **Image CI norm:** `cardBackgroundCombined@2x.png` → **lossless WebP**, native dimensions (`scripts/optimize-images.ts`). Prefer Apple Pay extracts over unknown-provenance uploads (“graduation-level”).
5. Community catalogs may help humans find which product name appears in `pass.json`, but must not become Sources or a bulk redistributed art CDN inside this repo.

## Follow-up TODOs

- [ ] Optional local helper: copy from `~/Library/Passes/Cards` on the contributor’s machine and print suggested `image` JSON (no network).
- [ ] Consider additive schema field `image.provenance` (`issuer_url` | `apple_pay` | `other` | null) so API clients can prefer graduation-level faces.
- [ ] Backfill seed Cards that still have `image.url: null` when a holder can extract Apple Pay art.

## Current catalog gap (as of research)

| Card Id | `image.url` |
|---------|-------------|
| us-chase-sapphire-preferred | issuer CDN |
| us-amex-gold | null |
| us-capital-one-venture | null |
| ca-* (3) | null |
| cn-* (3) | null |

## References (non-exhaustive)

- Apple / PassKit: Wallet pass package is a signed ZIP; payment cards use the Passes `Cards` tree (forensic survey: Sarah Edwards, OBTS “Pocket Litter”).
- Network digital art size: Visa/issuer docs and Google Pay TSP card-art guidance (~1536×969).
- Community extract path: `ab/card-designs` README (`cardBackgroundCombined@2x.png`).
- Community Apple Pay–sourced library: HarukaKinen/Cardentify (`source: "Apple Pay"`, names from `pass.json` `description`).
- OpenCard policy: ADR 0004, Spec #10, `images/README.md`.
