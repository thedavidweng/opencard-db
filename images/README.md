# Card images

## Policy

- **Prefer official issuer product-page image URLs** in each card’s `image.url` field. Do not treat this directory as the primary image CDN.
- Optional **local mirrors** may be stored here only when an official URL is unstable or unavailable for documentation/demo purposes.

## Uploading in a Pull Request

1. Name the file after the card id, e.g. `us-chase-sapphire-preferred.png` (`.jpg` / `.gif` also OK).
2. Add it under this `images/` folder in your PR.
3. CI runs **Optimize Images**: converts to **WebP**, max width **800px**, quality ~80 (same idea as Astro/image pipelines).
4. Set `image.local_path` in the card JSON to `images/us-chase-sapphire-preferred.webp` after CI finishes (or run `npm run optimize:images` locally first).
5. Keep `image.attribution` with the issuer copyright notice.

You can also paste a preview into the PR description on GitHub; that preview is **not** stored in the database — use an official URL or an `images/` upload for the Card record.

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
