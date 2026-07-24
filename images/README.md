# Card images

## Policy

- **Images are optional.** A card may ship with `image: null` or `image.url: null`.
- **Prefer official issuer product-page image URLs** in each card’s `image.url` field when available. Do not treat this directory as the primary image CDN.
- Optional **local mirrors** may be stored here only when an official URL is unstable or unavailable for documentation/demo purposes.
- The API always returns a usable `image.url`. Cards without artwork get the **generic fallback**: `images/default-card.webp`, served at `GET /v1/assets/default-card.webp`.

## Default / generic card face

| File | Purpose |
|------|---------|
| `images/default-card.svg` | Source artwork (OpenCard original placeholder — not bank art) |
| `images/default-card.webp` | Optimized asset mirrored into the Worker |
| `worker/src/default-card-asset.ts` | Embedded bytes for Cloudflare Workers (no KV/R2 required) |

Regenerate after editing the SVG (requires optional `sharp`):

```bash
npm i -D sharp
npm run embed:default-card
```

## Copyright

All **issuer** card face artwork remains the **copyright of the issuing bank or network**. OpenCard DB does **not** claim ownership of those images and does not relicense them under MIT or CC BY 4.0.

Local issuer mirrors are for **identification only**. They may be optimized (e.g. WebP) but must not be presented as OpenCard-owned assets.

The **generic** `default-card.*` files are original OpenCard placeholders (not bank artwork) and ship with the repository for API fallbacks.

## High-resolution digital art (Apple Pay)

Bank **digital wallet art** (what Apple Wallet shows) is often sharper than marketing-page photos. There is **no public Apple Pay card-art API** to scrape — see `docs/research/apple-pay-card-art.md`.

If you already have the Card in Apple Pay on a Mac, you may extract the face from your local Wallet bundle for an optional mirror:

```bash
# Own cards only. Typical asset:
# ~/Library/Passes/Cards/<id>.pkpass/cardBackgroundCombined@2x.png
# Product label for naming: pass.json → "description"
```

Prefer an official issuer `image.url` when it is clear and stable. Local mirrors remain bank copyright (below). Do not treat Apple, PayPal, or community card-art repos as Schema **Sources**.

## Attribution

If you add a local issuer mirror:

1. Name the file after the card id, e.g. `us-chase-sapphire-preferred.webp`.
2. Note the issuer copyright in the card JSON `image.attribution` field.
3. Reference the source product page in `sources`.

## Removal

Banks or rights holders may request removal of any local issuer mirror. Maintainers will remove the file promptly on a valid request (open an issue or email the maintainers listed in the GitHub org/repo). After removal, prefer switching the card to an official URL or `image.url: null` — the API will serve the generic fallback.
