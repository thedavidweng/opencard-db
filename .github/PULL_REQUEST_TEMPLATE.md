## Summary

<!-- What Card(s) or code change? -->

## Card checklist (data PRs)

- [ ] Official product and/or terms URLs in `sources`
- [ ] `last_verified` is today's date (or the day I checked)
- [ ] `id` matches `data/{country}/{slug}.json`
- [ ] Issuer and Network set independently
- [ ] Product marketing names are not stuffed into `network_tier`
- [ ] `npm run validate` passes

## Official Sources

1. 
2. 

## Card image (pick the best you can)

Graduation bar for local mirrors: **Apple Pay** digital wallet art  
(`cardBackgroundCombined@2x.png` → CI lossless WebP). Prefer this over random screenshots or unknown CDN crops.

- [ ] **A. Official issuer image URL** (stable product-page art)
  - URL: 
- [ ] **B. Apple Pay extract (preferred local mirror — “graduation-level”)**
  1. On a Mac with the card in Wallet, copy  
     `~/Library/Passes/Cards/*.pkpass/cardBackgroundCombined@2x.png`
  2. Rename to `{card-id}.png` (e.g. `us-chase-sapphire-preferred.png`) and add under `images/`
  3. CI converts to **lossless WebP** at native size (no 800px downscale)
  4. Set `image.local_path` to `images/{card-id}.webp`
  5. Attribution example: `© Issuer (Apple Pay digital card art)`
- [ ] **C. Other local upload** (marketing PNG/JPG — OK if no Apple Pay / official URL)
  - CI still emits lossless WebP; note the source in Notes
- [ ] **D. No image yet** (`image.url` / local mirror can stay null; API uses generic fallback)

- [ ] **TODO (optional follow-up):** If this PR ships without an Apple Pay face, open a follow-up to add one when someone who holds the card can extract it

## Notes

<!-- Anything reviewers should know about partial data / null fields / image provenance -->
