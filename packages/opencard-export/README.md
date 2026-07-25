# opencard-export

A tiny, zero-dependency macOS CLI that helps you contribute **Apple Pay card art
and data** to [OpenCard DB](https://github.com/thedavidweng/opencard-db).

It scans the payment cards already in your Apple Wallet, compares them against the
live OpenCard DB, and shows you exactly what's missing — a card that isn't in the
database, or one that's in the database but has no card face yet. With `--export`
it copies the digital card art so you can add it in a Pull Request.

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
npx opencard-export --export            # copy card art into ./ (or images/ in a repo checkout)
npx opencard-export --export ~/Desktop  # copy card art into a chosen folder
npx opencard-export --json              # machine-readable report (no colors)
npx opencard-export --no-remote         # skip the live DB comparison (offline)
npx opencard-export --help              # show help
```

- `--repo <path>` — an OpenCard DB checkout; exports go straight into its `images/`.
- `--passes-dir <path>` — override the Wallet directory (advanced / testing).
- `--no-color` — disable ANSI color (also honors `NO_COLOR`).

Non-payment passes (loyalty cards, tickets, boarding passes, store cards) are
never shown and never exported — they're just counted in a one-line summary.

## What the report looks like

```text
opencard-export v0.2.0
OpenCard DB · github.com/thedavidweng/opencard-db

● Sapphire Preferred (Chase)                                    complete
  → us-chase-sapphire-preferred · Fee ✓ APR ✓ FX ✓ Rewards ✓ Bonus ✓ Art ✓
● Gold Card (American Express)                                  missing art
  → us-amex-gold · Fee ✓ APR ✗ FX ✓ Rewards ✓ Bonus ✓ Art ✗
● My Local Credit Union (Some CU)                               not in DB
  → not in OpenCard DB yet

3 payment cards · 1 complete · 1 missing art · 1 not in DB
Ignored 32 non-payment passes (loyalty cards, tickets, boarding passes).

Next steps:
  • Missing art — run npx opencard-export --export, then add images/<card-id>.png in a PR
    (CI converts it to lossless WebP).
  • Not in OpenCard DB — open the Request-a-card form:
    https://github.com/thedavidweng/opencard-db/issues/new?template=add-card.yml
```

Each payment card is two lines:

- **Line 1** — a colored status dot, the card name, its issuer, and a status word:
  - 🟢 **complete** — in the DB and already has a card face.
  - 🟡 **missing art** — in the DB but no card face yet → run `--export`, add
    `images/<card-id>.png` via PR (CI converts it to lossless WebP).
  - 🔴 **not in DB** — not in OpenCard DB yet → open the
    [Request-a-card form](https://github.com/thedavidweng/opencard-db/issues/new?template=add-card.yml)
    or contribute a full card PR.
- **Line 2** — the matched Card Id and per-field completeness (`Fee`, `APR`, `FX`,
  `Rewards`, `Bonus`, `Art`), each marked `✓` (populated) or `✗` (missing).
  Unmatched cards show `→ not in OpenCard DB yet`.

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
  last-4 suffix (if Wallet exposes one) is used **on screen only** and is never
  written to any file or the `--json` output.

## License

MIT (code). Card face artwork remains the copyright of the issuing bank or network.
