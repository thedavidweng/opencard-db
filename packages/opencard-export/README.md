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
bunx opencard-export
```

Common flags:

```bash
npx opencard-export --export            # copy card art into ./ (or images/ in a repo checkout)
npx opencard-export --export ~/Desktop  # copy card art into a chosen folder
npx opencard-export --all               # also list non-payment passes (never exported)
npx opencard-export --json              # machine-readable report (no colors)
npx opencard-export --no-remote         # skip the live DB comparison (offline)
npx opencard-export --help              # bilingual help
```

- `--repo <path>` — an OpenCard DB checkout; exports go straight into its `images/`.
- `--passes-dir <path>` — override the Wallet directory (advanced / testing).
- `--no-color` — disable ANSI color (also honors `NO_COLOR`).

## What the report looks like

```text
OpenCard DB · Apple Pay 卡面贡献助手 / card-art contribution helper
Scanned 12 passes; 3 payment card(s).

┌─────────────────────┬─────────────┬────────────────────────────┬────────────┬─────────────────┬──────────────────────────┐
│ 钱包卡片            │ 发卡行      │ 匹配的 DB 卡片             │ 数据完整度 │ 卡面            │ 建议动作                 │
├─────────────────────┼─────────────┼────────────────────────────┼────────────┼─────────────────┼──────────────────────────┤
│ Sapphire Preferred  │ Chase       │ us-chase-sapphire-preferred │ ▮▮▮▮▮▮ 6/6 │ ✅ 已收录，已有卡面 │ 数据已完善，可核对       │
│ Gold Card           │ Amex        │ us-amex-gold                │ ▮▮▮▮▯▯ 4/6 │ 🟡 已收录，缺卡面  │ --export 后提交卡面 PR   │
│ My Local Credit U…  │ Some CU     │ —                          │ —          │ 🔴 数据库未收录  │ 开 Request-a-card / PR    │
└─────────────────────┴─────────────┴────────────────────────────┴────────────┴─────────────────┴──────────────────────────┘
```

- **数据完整度 / completeness** — how many of six core fields the matched DB card
  has populated: `annual_fee`, `apr`, `fx_fee`, `rewards`, `signup_bonus`, `image`.
- **卡面 / art state**
  - ✅ **已收录，已有卡面** — in the DB and already has a card face.
  - 🟡 **已收录，缺卡面** — in the DB but missing art → run `--export`, add
    `images/<card-id>.png` via PR (CI converts it to lossless WebP).
  - 🔴 **数据库未收录** — not in the DB yet → open the
    [Request-a-card form](https://github.com/thedavidweng/opencard-db/issues/new?template=add-card.yml)
    or contribute a full card PR.

## Full Disk Access (required)

macOS sandboxes `~/Library/Passes/`. The first time you run the tool your terminal
app needs **Full Disk Access**:

1. **System Settings → Privacy & Security → Full Disk Access**
2. Add and enable your terminal app (Terminal, iTerm2, VS Code, …).
3. **Fully quit** the terminal (Cmd+Q — not just the window) and reopen it.
4. Re-run `npx opencard-export`.

The tool prints this exact guide (bilingual, naming your terminal app) if it can't
read your Wallet, and exits with code `2`.

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
  last-4 suffix (if Wallet exposes one) is shown **on screen only** and is never
  written to any file or the `--json` output.

## License

MIT (code). Card face artwork remains the copyright of the issuing bank or network.
