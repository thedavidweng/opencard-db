import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSaveUrl,
  collectArchivableUrls,
  DEFAULT_BATCH,
  filterCardFiles,
  isoWeekNumber,
  isWaybackUrl,
  parseArgs,
  selectBatch,
  USER_AGENT,
  weekIndexFromKey,
} from "../../scripts/archive-sources.ts";

describe("collectArchivableUrls", () => {
  it("collects official_url plus every source, de-duplicated and sorted", () => {
    const urls = collectArchivableUrls([
      {
        official_url: "https://bank.example/card-a",
        sources: [
          "https://bank.example/card-a",
          "https://bank.example/terms-a",
        ],
      },
      {
        official_url: "https://bank.example/card-b",
        sources: ["https://bank.example/terms-a"], // dup across cards
      },
    ]);
    assert.deepEqual(urls, [
      "https://bank.example/card-a",
      "https://bank.example/card-b",
      "https://bank.example/terms-a",
    ]);
  });

  it("skips URLs already on the Wayback Machine", () => {
    const urls = collectArchivableUrls([
      {
        official_url: "https://web.archive.org/web/2020/https://bank.example/x",
        sources: [
          "https://archive.org/details/foo",
          "https://bank.example/live",
        ],
      },
    ]);
    assert.deepEqual(urls, ["https://bank.example/live"]);
  });

  it("ignores blanks, non-strings, and non-http(s) schemes", () => {
    const urls = collectArchivableUrls([
      {
        official_url: "  ",
        sources: [
          "",
          42 as unknown as string,
          null as unknown as string,
          "ftp://bank.example/file",
          "mailto:x@bank.example",
          "  https://bank.example/ok  ",
        ],
      },
      { sources: "not-an-array" as unknown as string[] },
      {},
    ]);
    assert.deepEqual(urls, ["https://bank.example/ok"]);
  });
});

describe("isWaybackUrl", () => {
  it("matches archive.org hosts only", () => {
    assert.equal(isWaybackUrl("https://web.archive.org/web/1/https://x"), true);
    assert.equal(isWaybackUrl("https://archive.org/details/x"), true);
    assert.equal(isWaybackUrl("https://sub.archive.org/x"), true);
    assert.equal(isWaybackUrl("https://bank.example/archive.org"), false);
    assert.equal(isWaybackUrl("not a url"), false);
  });
});

describe("filterCardFiles", () => {
  it("keeps only data/<country>/<slug>.json, dropping registries and noise", () => {
    const kept = filterCardFiles([
      "data/us/amex-gold.json",
      "./data/ca/scotia-momentum.json",
      "data/cn/some-card.json ",
      "data/issuers.json", // registry — excluded
      "data/network-tiers.json", // registry — excluded
      "data/us/nested/deep.json", // too deep — excluded
      "docs/contributing.md", // not data — excluded
      "data/us/amex-gold.json", // duplicate
      "",
    ]);
    assert.deepEqual(kept, [
      "data/us/amex-gold.json",
      "data/ca/scotia-momentum.json",
      "data/cn/some-card.json",
    ]);
  });
});

describe("isoWeekNumber / weekIndexFromKey", () => {
  it("computes ISO-8601 week numbers in UTC", () => {
    assert.equal(isoWeekNumber(new Date("2026-01-01T00:00:00Z")), 1);
    assert.equal(isoWeekNumber(new Date("2026-01-05T00:00:00Z")), 2); // Monday
    assert.equal(isoWeekNumber(new Date("2007-01-01T00:00:00Z")), 1); // Monday
    assert.equal(isoWeekNumber(new Date("2005-01-01T00:00:00Z")), 53); // W53/2004
  });

  it("derives the week from a date-ish key and falls back to 0", () => {
    assert.equal(weekIndexFromKey("2026-01-05"), 2);
    assert.equal(weekIndexFromKey(""), 0);
    assert.equal(weekIndexFromKey("not-a-date"), 0);
  });
});

describe("selectBatch", () => {
  const urls = Array.from(
    { length: 10 },
    (_, i) => `https://bank.example/${String(i).padStart(2, "0")}`,
  );

  it("returns the whole sorted set when batch >= total or batch <= 0", () => {
    assert.deepEqual(selectBatch(urls, 10, "2026-01-05"), [...urls].sort());
    assert.deepEqual(selectBatch(urls, 99, "2026-01-05"), [...urls].sort());
    assert.deepEqual(selectBatch(urls, 0, "2026-01-05"), [...urls].sort());
    assert.deepEqual(selectBatch([], 3, "2026-01-05"), []);
  });

  it("is deterministic and offset by the ISO week", () => {
    // week 2 → start = (2*3) % 10 = 6 → indices 6,7,8
    assert.deepEqual(selectBatch(urls, 3, "2026-01-05"), [
      "https://bank.example/06",
      "https://bank.example/07",
      "https://bank.example/08",
    ]);
    // week 3 → start = (3*3) % 10 = 9 → indices 9,0,1 (wraps)
    assert.deepEqual(selectBatch(urls, 3, "2026-01-12"), [
      "https://bank.example/09",
      "https://bank.example/00",
      "https://bank.example/01",
    ]);
  });

  it("never repeats a URL within one batch", () => {
    const batch = selectBatch(urls, 7, "2026-01-05");
    assert.equal(new Set(batch).size, batch.length);
  });

  it("covers the whole set over ceil(total/batch) consecutive weeks", () => {
    const batch = 3;
    const weeks = Math.ceil(urls.length / batch); // 4
    const covered = new Set<string>();
    // Consecutive Mondays advance the ISO week by one each time.
    const mondays = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"];
    for (let w = 0; w < weeks; w++) {
      for (const u of selectBatch(urls, batch, mondays[w])) covered.add(u);
    }
    assert.equal(covered.size, urls.length);
  });
});

describe("buildSaveUrl / USER_AGENT", () => {
  it("appends the raw target to the Save Page Now endpoint", () => {
    assert.equal(
      buildSaveUrl("https://bank.example/card?x=1"),
      "https://web.archive.org/save/https://bank.example/card?x=1",
    );
  });

  it("identifies the archiver with a descriptive, repo-linked UA", () => {
    assert.match(USER_AGENT, /^opencard-db-archiver\/1\.0 \(\+https:\/\/github\.com\//);
  });
});

describe("parseArgs", () => {
  it("defaults to archiving everything", () => {
    const cfg = parseArgs([], {});
    assert.equal(cfg.mode, "all");
    assert.equal(cfg.batch, DEFAULT_BATCH);
    assert.deepEqual(cfg.changedFiles, []);
  });

  it("parses --changed and filters to real card files", () => {
    const cfg = parseArgs(
      ["--changed", "data/us/a.json", "data/issuers.json", "README.md"],
      {},
    );
    assert.equal(cfg.mode, "changed");
    assert.deepEqual(cfg.changedFiles, ["data/us/a.json"]);
  });

  it("folds CHANGED_FILES env into the changed set", () => {
    const cfg = parseArgs([], {
      CHANGED_FILES: "data/us/a.json\ndata/ca/b.json data/issuers.json",
    });
    assert.equal(cfg.mode, "changed");
    assert.deepEqual(cfg.changedFiles, ["data/us/a.json", "data/ca/b.json"]);
  });

  it("parses --batch and --offset-key (space and = forms)", () => {
    const a = parseArgs(["--batch", "40", "--offset-key", "2026-07-25"], {});
    assert.equal(a.mode, "batch");
    assert.equal(a.batch, 40);
    assert.equal(a.offsetKey, "2026-07-25");

    const b = parseArgs(["--batch=25", "--offset-key=2026-07-25"], {});
    assert.equal(b.mode, "batch");
    assert.equal(b.batch, 25);
    assert.equal(b.offsetKey, "2026-07-25");
  });

  it("lets ARCHIVE_BATCH / OFFSET_KEY env fill in batch mode", () => {
    const cfg = parseArgs(["--batch", "40"], {
      ARCHIVE_BATCH: "12",
      OFFSET_KEY: "2026-07-25",
    });
    assert.equal(cfg.mode, "batch");
    assert.equal(cfg.batch, 12);
    assert.equal(cfg.offsetKey, "2026-07-25");
  });
});
