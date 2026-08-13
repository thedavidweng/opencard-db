# opencard-export

A tiny, zero-dependency macOS CLI that helps you contribute **Apple Pay card art
and data** to [OpenCard DB](https://github.com/thedavidweng/opencard-db).

It scans the payment cards already in your Apple Wallet, compares them against the
live OpenCard DB, and shows you exactly what to contribute — a card that isn't in
the database, one that has no card face yet, or one whose art your lossless Apple
Pay export could improve. It hashes each local card face (sha256) and compares it
against the DB's art lineage, so it can tell whether the DB already has your exact
art or something better is possible. With `--export` it copies the digital card
art (and prints a ready-to-paste provenance block) so you can add it in a Pull
Request.

> **Everything runs locally. Nothing is uploaded.** The tool never reads or prints
> your card numbers or tokens. Card face artwork stays the copyright of the issuing
> bank — export is only to help contribute to OpenCard DB (which has a takedown
> channel, see the repo's `SECURITY.md`).

## Usage

No install needed:

```bash
npx opencard-export          # scan + report (writes no files)
# or
bunx opencard-export@latest
```

Common flags:

```bash
npx opencard-export --export            # copy card art into images/ in a checkout, else ./
npx opencard-export --export ~/Desktop  # extra copy; a checkout still gets images/ + provenance
npx opencard-export --export --pr       # commit and open the GitHub PR (needs gh)
npx opencard-export --json              # machine-readable report (no colors)
npx opencard-export --no-remote         # skip the public export; a checkout still reads data/
npx opencard-export --help              # show help
```

- `--repo <path>` — an OpenCard DB checkout; compared against local `data/`
  (not the stale public export), PNGs go into `images/`, and each matched
  card's JSON gets `image.provenance` + Apple Pay attribution written in place.
  A checkout is also auto-detected by walking up from the current directory.
- `--pr` — after a successful `--export` into a checkout, commit the art and
  open a filled-in `card(update)` (or bulk) Pull Request. Requires `git` + `gh`.
- `--passes-dir <path>` — override the Wallet directory (advanced / testing).
- `--no-color` — disable ANSI color (also honors `NO_COLOR`).

In a clone, run `npm ci` first so `npx opencard-export` uses this checkout's
CLI (the root package exposes the local bin). Without a clone, `npx` fetches
the published package from npm.

Non-payment passes (loyalty cards, tickets, boarding passes, store cards) are
never shown and never exported — they're just counted in a one-line summary.

## What the report looks like

```text
NAME                 ISSUER            MATCH                        DATA  STATUS
Sapphire Preferred   Chase             us-chase-sapphire-preferred  6/6   up to date
Aurora Signature     Northwind         us-northwind-aurora          6/6   art wanted
Gold Card            American Express  us-amex-gold                 5/6   art wanted
My Local Card        Some CU           -                            -     not in database

4 payment cards: 2 art wanted, 1 not in database, 1 up to date
Ignored 32 non-payment passes (loyalty cards, tickets, boarding passes).

To contribute card art (2 cards), run: npx opencard-export --export
To request a missing card: https://github.com/thedavidweng/opencard-db/issues/new?template=add-card.yml
```

Columns:

- **MATCH**: the OpenCard DB card id, or `-` when the card is not in the
  database yet.
- **DATA**: how many of the six core fields (fee, APR, FX, rewards, bonus,
  art) the DB card has filled in.
- **STATUS**: what your wallet card means for the database. Three states:
  - **`not in database`** (red): no entry exists for this card. You can
    contribute a whole new card, or open the
    [Request-a-card form](https://github.com/thedavidweng/opencard-db/issues/new?template=add-card.yml).
  - **`art wanted`** (yellow): the card is in the database, but this Apple Pay
    card face is not. Maybe the entry has no art, maybe it only has issuer-site
    art, maybe the design changed; either way `--export` and a PR would add
    something new.
  - **`up to date`** (green): the database already has this card and this
    exact art (matched by sha256 against the card's whole art lineage).
    Contributing again would be a duplicate.

  The finer detail behind `art wanted` is in `--json`: `db_art` says what the
  database currently holds (`apple-pay`, `issuer`, or `none`, the same
  vocabulary as the exports' `art_grade`) and `same_art` says whether your
  export is already in the lineage.

## How card art improves

OpenCard DB prefers the lossless Apple Pay card face over issuer-site scrapes.
The loop:

1. **Scan** — run `npx opencard-export`; each matched card's face is hashed and
   compared against the database's art lineage.
2. **Export + provenance** — run `--export`. Alongside `<card-id>.png` the tool
   prints the sha256 and a paste-ready provenance block:

   ```json
   "provenance": {
     "source": "apple-pay",
     "source_sha256": "…",
     "width": 1290,
     "height": 810,
     "exported_at": "2026-07-25"
   }
   ```

   Width/height come from the PNG's `IHDR` header (parsed with Node built-ins — no
   image library). With `--repo <path>` the block is written straight into the
   checkout's card JSON (`image.provenance`, plus `image.local_path` when it was
   absent) and the PNG is dropped into `images/<card-id>.png`.
3. **PR** — open a Pull Request with the art and provenance.
4. **CI verifies the sha chain** — converts the PNG to lossless WebP (recording
   `converted_sha256`), and superseded designs move to `images/archive/…` and are
   appended to `image.history[]` so grandfathered card faces stay addressable.

The next contributor's scan then reports the card as `up to date`, because their
export's sha256 is now in the DB's known lineage
(`source_sha256` + `alternate_sha256[]` + every `history[].source_sha256`).

## Full Disk Access (required)

macOS sandboxes `~/Library/Passes/`. The first time you run the tool your terminal
app needs **Full Disk Access**:

1. **System Settings → Privacy & Security → Full Disk Access**
2. Add and enable your terminal app (Terminal, iTerm2, VS Code, …).
3. **Fully quit** the terminal (Cmd+Q — not just the window) and reopen it.
4. Re-run `npx opencard-export`.

The tool prints this exact guide (naming your terminal app) if it can't read your
Wallet, and exits with code `2`.

## How a card is exported

On `--export`, for each **payment** card the tool copies
`cardBackgroundCombined@2x.png` (falling back to the largest available background
asset) to `<matched-card-id>.png` (or a slug of the card name when unmatched). It
then prints the attribution you should record:

```text
© <Issuer> (Apple Pay digital card art)
```

Non-payment passes (loyalty cards, boarding passes, event tickets, store cards) are
**never** exported.

## Privacy

- Runs entirely on your machine. There is no network call except an optional,
  read-only fetch of the public OpenCard DB export for comparison.
- Never reads, stores, logs, or transmits PANs, tokens, or personal values. A card's
  last-4 suffix (if Wallet exposes one) stays local and is never written to any
  file or the `--json` output.

## License

MIT (code). Card face artwork remains the copyright of the issuing bank or network.
