# Git repository is the system of record for Card data

Card facts live only under `data/` in this GitHub repository. The sole write path is a Pull Request (prefer one Card per PR) with mandatory Sources and Last Verified. There is no public write API. CI validates on every PR; merge to `main` rebuilds pre-aggregated indexes and may sync them to Cloudflare KV for the read API. Consumers may use the HTTP API or read JSON files directly from the repo.

**Status:** accepted

**Considered options:** API-as-source-of-record; dual-write (PR + maintainer API). Rejected to keep auditability, community review, offline access, and zero write-abuse surface on the free instance.
