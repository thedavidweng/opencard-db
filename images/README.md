# Card images

## Policy

- **Prefer official issuer product-page image URLs** in each card’s `image.url` field. Do not treat this directory as the primary image CDN.
- Optional **local mirrors** may be stored here only when an official URL is unstable or unavailable for documentation/demo purposes.

## Copyright

All card face artwork remains the **copyright of the issuing bank or network**. OpenCard DB does **not** claim ownership of these images and does not relicense them under MIT or CC BY 4.0.

Local files are for **identification only**. They may be optimized (e.g. WebP) but must not be presented as OpenCard-owned assets.

## Attribution

If you add a local mirror:

1. Name the file after the card id, e.g. `us-chase-sapphire-preferred.webp`.
2. Note the issuer copyright in the card JSON `image.attribution` field.
3. Reference the source product page in `sources`.

## Removal

Banks or rights holders may request removal of any local mirror. Maintainers will remove the file promptly on a valid request (open an issue or email the maintainers listed in the GitHub org/repo). After removal, prefer switching the card to an official URL or `image.url: null` with a note.
