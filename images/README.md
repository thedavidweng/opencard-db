# Card images

## Policy

- **Images are optional.** A card may ship with `image: null` or `image.url: null`.
- **Prefer official issuer product-page image URLs** in each card’s `image.url` field when available. Do not treat this directory as the primary image CDN.
- Optional **local mirrors** may be stored here when an official URL is unstable, unavailable, or lower quality than digital wallet art.
- **Graduation-level local mirror:** Apple Pay `cardBackgroundCombined@2x.png` converted to **lossless WebP** (see below). Prefer this over screenshots or unknown crops.
- The API always returns a usable `image.url`. Cards without artwork get the **generic fallback**: `images/default-card.webp`, served at `GET /v1/assets/default-card.webp`.

## Default / generic card face

| File | Purpose |
|------|---------|
| `images/default-card.svg` | Source artwork (OpenCard original placeholder — not bank art) |
| `images/default-card.webp` | Optimized asset mirrored into the Worker |
| `worker/src/default-card-asset.ts` | Embedded bytes for Cloudflare Workers (no KV/R2 required) |

Regenerate after editing the SVG (requires `sharp`):

```bash
npm ci
npm run embed:default-card
```

## Uploading in a Pull Request

### Preferred: Apple Pay extract (“graduation-level”)

**One command (recommended):** on a Mac with the card in Apple Pay, run
[`npx opencard-export --export`](../packages/opencard-export). It finds your payment
cards, names each exported face after the matched Card Id, and prints the exact
attribution to record. Everything runs locally; nothing is uploaded.

Manual fallback:

1. On a Mac that already has the card in Wallet, copy  
   `~/Library/Passes/Cards/<id>.pkpass/cardBackgroundCombined@2x.png`
2. Rename to the Card Id, e.g. `us-chase-sapphire-preferred.png`, and add under `images/`.
3. CI runs **Optimize Images** only when the PR includes a raster under `images/` (`.png` / `.jpg` / …). Docs-only or `.webp`-only changes skip that workflow. Conversion is **lossless WebP**, **native dimensions** (no 800px downscale) — fidelity matched to Apple Pay @2x.
4. Set `image.local_path` to `images/us-chase-sapphire-preferred.webp` after CI (or run `npm run optimize:images` locally first).
5. Attribution example: `© Chase (Apple Pay digital card art)`.

Background: `docs/research/apple-pay-card-art.md`. Do **not** scrape Apple remotely; only extract cards you already provisioned.

### Also OK

- Official issuer `image.url` when clear and stable.
- Other PNG/JPG uploads when Apple Pay / official URL is unavailable — same lossless WebP CI; note provenance in the PR.

```bash
npm run optimize:images
```

You can paste a preview into the PR description on GitHub; that preview is **not** stored in the database — use an official URL or an `images/` upload for the Card record.

## Copyright

All **issuer** card face artwork remains the **copyright of the issuing bank or network**. OpenCard DB does **not** claim ownership of those images and does not relicense them under MIT or CC BY 4.0.

Local issuer mirrors are for **identification only**. They may be optimized (lossless WebP) but must not be presented as OpenCard-owned assets.

The **generic** `default-card.*` files are original OpenCard placeholders (not bank artwork) and ship with the repository for API fallbacks.

Do not treat Apple, PayPal, or community card-art repos as Schema **Sources**.

## Attribution

If you add a local issuer mirror:

1. Name the file after the card id, e.g. `us-chase-sapphire-preferred.webp`.
2. Note the issuer copyright in the card JSON `image.attribution` field (mention Apple Pay when that was the extract source).
3. Reference the source product page in `sources`.

## Removal

Banks or rights holders may request removal of any local issuer mirror. Maintainers will remove the file promptly on a valid request (open an issue or email the maintainers listed in the GitHub org/repo). After removal, prefer switching the card to an official URL or `image.url: null` — the API will serve the generic fallback.
