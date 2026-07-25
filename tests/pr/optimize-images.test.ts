import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  applyArtJsonEdits,
  archivePathFor,
  type ArtProvenance,
  type ArtVerifyInput,
  optimizeImages,
  planArtEdits,
  planArtVerification,
  replaceImageBlock,
  runArtChain,
  sha256,
  verifyClaim,
  WEBP_EFFORT,
  WEBP_LOSSLESS,
} from "../../scripts/optimize-images.ts";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_WEBP = "d".repeat(64);

function baseInput(over: Partial<ArtVerifyInput> = {}): ArtVerifyInput {
  return {
    cardId: "us-demo",
    submittedSha256: SHA_A,
    convertedSha256: SHA_WEBP,
    webpPath: "images/us-demo.webp",
    headProvenance: null,
    existingLocalPath: null,
    baseProvenance: null,
    baseWebpExists: false,
    today: "2026-07-25",
    ...over,
  };
}

const prov = (over: Partial<ArtProvenance> = {}): ArtProvenance => ({
  source: "apple-pay",
  source_sha256: SHA_A,
  ...over,
});

describe("optimize images: conversion", () => {
  it("uses lossless WebP settings (Apple Pay @2x norm)", () => {
    assert.equal(WEBP_LOSSLESS, true);
    assert.equal(WEBP_EFFORT, 6);
  });

  it("converts png uploads to lossless webp without downscaling", async () => {
    const dir = path.join("/tmp", `opencard-img-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const png = path.join(dir, "us-demo-card.png");
    await sharp({
      create: {
        width: 320,
        height: 202,
        channels: 3,
        background: { r: 20, g: 40, b: 80 },
      },
    })
      .png()
      .toFile(png);

    const result = await optimizeImages(dir);
    assert.equal(result.written.length, 1);
    assert.ok(result.written[0].endsWith(".webp"));
    assert.ok(existsSync(result.written[0]));
    assert.equal(existsSync(png), false);

    const meta = await sharp(result.written[0]).metadata();
    assert.equal(meta.width, 320);
    assert.equal(meta.height, 202);
    assert.equal(meta.format, "webp");

    await rm(dir, { recursive: true, force: true });
  });

  it("leaves existing webp untouched", async () => {
    const dir = path.join("/tmp", `opencard-webp-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const webp = path.join(dir, "already.webp");
    await sharp({
      create: {
        width: 1600,
        height: 1010,
        channels: 3,
        background: { r: 10, g: 10, b: 10 },
      },
    })
      .webp({ lossless: true })
      .toFile(webp);

    const before = await sharp(webp).metadata();
    const result = await optimizeImages(dir);
    assert.equal(result.written.length, 0);
    assert.ok(result.skipped.some((p) => p.endsWith("already.webp")));
    const after = await sharp(webp).metadata();
    assert.equal(after.width, before.width);
    assert.equal(after.height, before.height);

    await rm(dir, { recursive: true, force: true });
  });
});

describe("verifyClaim (step 1)", () => {
  it("no provenance block → no-claim warning mentioning opencard-export", () => {
    const r = verifyClaim(SHA_A, null, "us-demo");
    assert.equal(r.status, "no-claim");
    assert.match(r.message ?? "", /npx opencard-export --repo \./);
  });

  it("submitted matches source_sha256 → ok", () => {
    assert.equal(verifyClaim(SHA_A, prov()).status, "ok");
  });

  it("submitted matches an alternate_sha256 → ok", () => {
    const r = verifyClaim(SHA_C, prov({ alternate_sha256: [SHA_B, SHA_C] }));
    assert.equal(r.status, "ok");
  });

  it("case-insensitive match", () => {
    const r = verifyClaim(SHA_A.toUpperCase(), prov());
    assert.equal(r.status, "ok");
  });

  it("no match → mismatch with the required message", () => {
    const r = verifyClaim(SHA_C, prov(), "us-demo");
    assert.equal(r.status, "mismatch");
    assert.match(
      r.message ?? "",
      /not the one the provenance block describes/,
    );
  });
});

describe("planArtEdits (steps 3/4)", () => {
  it("no base webp → no archive, no history", () => {
    const { archivePath, jsonEdits } = planArtEdits(
      baseInput({ headProvenance: prov() }),
    );
    assert.equal(archivePath, null);
    assert.equal(jsonEdits.appendHistory, null);
  });

  it("fills converted_sha256 only when a provenance block exists", () => {
    assert.equal(
      planArtEdits(baseInput({ headProvenance: prov() })).jsonEdits
        .convertedSha256,
      SHA_WEBP,
    );
    assert.equal(
      planArtEdits(baseInput({ headProvenance: null })).jsonEdits
        .convertedSha256,
      null,
    );
  });

  it("sets local_path only when absent", () => {
    assert.equal(
      planArtEdits(baseInput()).jsonEdits.localPath,
      "images/us-demo.webp",
    );
    assert.equal(
      planArtEdits(baseInput({ existingLocalPath: "images/us-demo.webp" }))
        .jsonEdits.localPath,
      null,
    );
  });

  it("base webp exists → archive path + history carrying OLD provenance", () => {
    const { archivePath, jsonEdits } = planArtEdits(
      baseInput({
        headProvenance: prov({ source_sha256: SHA_B }),
        baseProvenance: prov({ source: "issuer-site", source_sha256: SHA_A }),
        baseWebpExists: true,
      }),
    );
    assert.equal(archivePath, "images/archive/us-demo.20260725.webp");
    assert.deepEqual(jsonEdits.appendHistory, {
      local_path: "images/archive/us-demo.20260725.webp",
      source: "issuer-site",
      source_sha256: SHA_A,
      superseded_at: "2026-07-25",
      note: null,
    });
  });

  it("base webp exists but no base provenance → source other / null hash", () => {
    const { jsonEdits } = planArtEdits(
      baseInput({ baseProvenance: null, baseWebpExists: true }),
    );
    assert.equal(jsonEdits.appendHistory?.source, "other");
    assert.equal(jsonEdits.appendHistory?.source_sha256, null);
  });

  it("archive path is under images/archive/ (validator lint #327)", () => {
    assert.ok(archivePathFor("us-demo", "2026-07-25").startsWith("images/archive/"));
  });
});

describe("planArtVerification (composed)", () => {
  it("mismatch short-circuits: no edits, no archive", () => {
    const plan = planArtVerification(
      baseInput({
        submittedSha256: SHA_C,
        headProvenance: prov({ source_sha256: SHA_A }),
        baseWebpExists: true,
      }),
    );
    assert.equal(plan.verify, "mismatch");
    assert.equal(plan.archivePath, null);
    assert.deepEqual(plan.jsonEdits, {
      convertedSha256: null,
      localPath: null,
      appendHistory: null,
    });
  });

  it("ok + replacement: converted_sha256, local_path, archive + history", () => {
    const plan = planArtVerification(
      baseInput({
        headProvenance: prov(),
        baseProvenance: prov({ source: "apple-pay", source_sha256: SHA_B }),
        baseWebpExists: true,
      }),
    );
    assert.equal(plan.verify, "ok");
    assert.equal(plan.archivePath, "images/archive/us-demo.20260725.webp");
    assert.equal(plan.jsonEdits.convertedSha256, SHA_WEBP);
    assert.equal(plan.jsonEdits.localPath, "images/us-demo.webp");
    assert.equal(plan.jsonEdits.appendHistory?.source_sha256, SHA_B);
  });

  it("no-claim still converts + fills local_path (never converted_sha256)", () => {
    const plan = planArtVerification(baseInput({ headProvenance: null }));
    assert.equal(plan.verify, "no-claim");
    assert.equal(plan.jsonEdits.localPath, "images/us-demo.webp");
    assert.equal(plan.jsonEdits.convertedSha256, null);
  });
});

describe("applyArtJsonEdits", () => {
  it("no work → unchanged", () => {
    const r = applyArtJsonEdits(
      { url: "x" },
      { convertedSha256: null, localPath: null, appendHistory: null },
    );
    assert.equal(r.changed, false);
    assert.deepEqual(r.image, { url: "x" });
  });

  it("creates image object when null and local_path is set", () => {
    const r = applyArtJsonEdits(null, {
      convertedSha256: null,
      localPath: "images/us-demo.webp",
      appendHistory: null,
    });
    assert.equal(r.changed, true);
    assert.deepEqual(r.image, { local_path: "images/us-demo.webp" });
  });

  it("fills provenance.converted_sha256 without touching other keys", () => {
    const image = {
      url: null,
      provenance: { source: "apple-pay", source_sha256: SHA_A },
    };
    const r = applyArtJsonEdits(image, {
      convertedSha256: SHA_WEBP,
      localPath: null,
      appendHistory: null,
    });
    assert.equal(r.changed, true);
    assert.deepEqual(r.image, {
      url: null,
      provenance: {
        source: "apple-pay",
        source_sha256: SHA_A,
        converted_sha256: SHA_WEBP,
      },
    });
  });

  it("converted_sha256 already equal → no change", () => {
    const image = {
      provenance: {
        source: "apple-pay",
        source_sha256: SHA_A,
        converted_sha256: SHA_WEBP,
      },
    };
    const r = applyArtJsonEdits(image, {
      convertedSha256: SHA_WEBP,
      localPath: null,
      appendHistory: null,
    });
    assert.equal(r.changed, false);
  });

  it("appends to existing history (never replaces)", () => {
    const image = {
      history: [{ local_path: "images/archive/us-demo.20250101.webp" }],
    };
    const entry = {
      local_path: "images/archive/us-demo.20260725.webp",
      source: "other" as const,
      source_sha256: null,
      superseded_at: "2026-07-25",
      note: null,
    };
    const r = applyArtJsonEdits(image, {
      convertedSha256: null,
      localPath: null,
      appendHistory: entry,
    });
    assert.equal((r.image?.history as unknown[]).length, 2);
    assert.deepEqual((r.image?.history as unknown[])[1], entry);
  });

  it("does not mutate the input image object", () => {
    const image = { provenance: { source: "apple-pay", source_sha256: SHA_A } };
    applyArtJsonEdits(image, {
      convertedSha256: SHA_WEBP,
      localPath: "images/us-demo.webp",
      appendHistory: null,
    });
    assert.equal(
      (image.provenance as Record<string, unknown>).converted_sha256,
      undefined,
    );
    assert.equal((image as Record<string, unknown>).local_path, undefined);
  });
});

describe("replaceImageBlock (minimal-diff surgical edit)", () => {
  const card = [
    "{",
    '  "id": "us-demo",',
    '  "name": "Demo",',
    "",
    '  "image": {',
    '    "url": null,',
    '    "local_path": null',
    "  },",
    "",
    '  "status": "active"',
    "}",
    "",
  ].join("\n");

  it("replaces only the image block, preserving blank lines + siblings", () => {
    const out = replaceImageBlock(card, {
      url: null,
      local_path: "images/us-demo.webp",
    });
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.image, {
      url: null,
      local_path: "images/us-demo.webp",
    });
    // Everything outside the image block is byte-identical.
    assert.ok(out.startsWith('{\n  "id": "us-demo",\n  "name": "Demo",\n\n'));
    assert.ok(out.includes('\n\n  "status": "active"\n}\n'));
  });

  it("replaces a null image with an object", () => {
    const nullCard = '{\n  "image": null,\n  "status": "active"\n}\n';
    const out = replaceImageBlock(nullCard, { local_path: "images/x.webp" });
    assert.deepEqual(JSON.parse(out).image, { local_path: "images/x.webp" });
    assert.ok(out.includes('\n  "status": "active"\n'));
  });

  it("keeps a trailing comma when image is not the last property", () => {
    const out = replaceImageBlock(card, { url: null });
    assert.match(out, /\n {2}\},\n\n {2}"status"/);
  });
});

describe("runArtChain (end-to-end with injected git seam)", () => {
  async function scaffold(): Promise<string> {
    const repo = path.join("/tmp", `opencard-chain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(path.join(repo, "images"), { recursive: true });
    await mkdir(path.join(repo, "data", "us"), { recursive: true });
    return repo;
  }

  async function makePng(file: string): Promise<string> {
    await sharp({
      create: {
        width: 64,
        height: 40,
        channels: 3,
        background: { r: 5, g: 90, b: 160 },
      },
    })
      .png()
      .toFile(file);
    return sha256(await readFile(file));
  }

  const noBase = {
    baseSha: "",
    readBaseText: () => null,
    readBaseBuffer: () => null,
  };

  it("verified art: converts, fills converted_sha256 + local_path", async () => {
    const repo = await scaffold();
    const png = path.join(repo, "images", "us-demo.png");
    const submitted = await makePng(png);
    const cardFile = path.join(repo, "data", "us", "demo.json");
    await writeFile(
      cardFile,
      JSON.stringify(
        {
          id: "us-demo",
          image: {
            url: null,
            local_path: null,
            provenance: { source: "apple-pay", source_sha256: submitted },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const res = await runArtChain({
      repoRoot: repo,
      today: "2026-07-25",
      ...noBase,
      convert: (await import("../../scripts/optimize-images.ts")).convertToWebp,
    });

    assert.equal(res.errors.length, 0);
    assert.equal(res.plans[0].verify, "ok");
    assert.ok(existsSync(path.join(repo, "images", "us-demo.webp")));
    assert.equal(existsSync(png), false);
    const card = JSON.parse(await readFile(cardFile, "utf8"));
    assert.equal(card.image.local_path, "images/us-demo.webp");
    assert.match(card.image.provenance.converted_sha256, /^[a-f0-9]{64}$/);
    await rm(repo, { recursive: true, force: true });
  });

  it("mismatch: hard error, raster left in place, no webp written", async () => {
    const repo = await scaffold();
    const png = path.join(repo, "images", "us-demo.png");
    await makePng(png);
    await writeFile(
      path.join(repo, "data", "us", "demo.json"),
      JSON.stringify(
        {
          id: "us-demo",
          image: {
            provenance: { source: "apple-pay", source_sha256: SHA_A },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const res = await runArtChain({
      repoRoot: repo,
      today: "2026-07-25",
      ...noBase,
      convert: async () => {
        throw new Error("convert must not run on a mismatch");
      },
    });

    assert.equal(res.errors.length, 1);
    assert.equal(res.plans[0].verify, "mismatch");
    assert.ok(existsSync(png), "raster is not converted on mismatch");
    assert.equal(existsSync(path.join(repo, "images", "us-demo.webp")), false);
    await rm(repo, { recursive: true, force: true });
  });

  it("no provenance: warning, converts, sets local_path", async () => {
    const repo = await scaffold();
    const png = path.join(repo, "images", "us-demo.png");
    await makePng(png);
    const cardFile = path.join(repo, "data", "us", "demo.json");
    await writeFile(
      cardFile,
      JSON.stringify({ id: "us-demo", image: { url: null, local_path: null } }, null, 2) +
        "\n",
    );

    const res = await runArtChain({
      repoRoot: repo,
      today: "2026-07-25",
      ...noBase,
      convert: (await import("../../scripts/optimize-images.ts")).convertToWebp,
    });

    assert.equal(res.errors.length, 0);
    assert.equal(res.warnings.length, 1);
    assert.equal(res.plans[0].verify, "no-claim");
    const card = JSON.parse(await readFile(cardFile, "utf8"));
    assert.equal(card.image.local_path, "images/us-demo.webp");
    assert.equal(card.image.provenance, undefined);
    await rm(repo, { recursive: true, force: true });
  });

  it("archive-on-replace: old base webp archived + history appended", async () => {
    const repo = await scaffold();
    const png = path.join(repo, "images", "us-demo.png");
    const submitted = await makePng(png);
    const cardFile = path.join(repo, "data", "us", "demo.json");
    await writeFile(
      cardFile,
      JSON.stringify(
        {
          id: "us-demo",
          image: {
            local_path: "images/us-demo.webp",
            provenance: { source: "apple-pay", source_sha256: submitted },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const oldWebp = Buffer.from("OLD-WEBP-BYTES");
    const baseCard =
      JSON.stringify(
        {
          id: "us-demo",
          image: {
            local_path: "images/us-demo.webp",
            provenance: { source: "issuer-site", source_sha256: SHA_B },
          },
        },
        null,
        2,
      ) + "\n";

    const res = await runArtChain({
      repoRoot: repo,
      today: "2026-07-25",
      baseSha: "BASESHA",
      readBaseText: (_sha, p) => (p.endsWith("demo.json") ? baseCard : null),
      readBaseBuffer: (_sha, p) =>
        p === "images/us-demo.webp" ? oldWebp : null,
      convert: (await import("../../scripts/optimize-images.ts")).convertToWebp,
    });

    assert.equal(res.errors.length, 0);
    const archived = path.join(repo, "images", "archive", "us-demo.20260725.webp");
    assert.ok(existsSync(archived), "old art archived");
    assert.deepEqual(await readFile(archived), oldWebp);

    const card = JSON.parse(await readFile(cardFile, "utf8"));
    assert.equal(card.image.history.length, 1);
    assert.equal(
      card.image.history[0].local_path,
      "images/archive/us-demo.20260725.webp",
    );
    assert.equal(card.image.history[0].source, "issuer-site");
    assert.equal(card.image.history[0].source_sha256, SHA_B);
    assert.equal(card.image.history[0].superseded_at, "2026-07-25");
    await rm(repo, { recursive: true, force: true });
  });
});
it("planArtEdits repoints local_path from the removed source raster to the webp", () => {
  const base = {
    cardId: "us-demo",
    convertedSha256: "c".repeat(64),
    webpPath: "images/us-demo.webp",
    headProvenance: { source: "apple-pay", source_sha256: "a".repeat(64) },
    baseProvenance: null,
    baseWebpExists: false,
    today: "2026-07-25",
  };
  // CLI dropped the png and set local_path to it — must repoint to the webp.
  const fromPng = planArtEdits({ ...base, existingLocalPath: "images/us-demo.png" } as never);
  assert.equal(fromPng.jsonEdits.localPath, "images/us-demo.webp");
  // Already correct — no edit.
  const already = planArtEdits({ ...base, existingLocalPath: "images/us-demo.webp" } as never);
  assert.equal(already.jsonEdits.localPath, null);
  // Custom different-stem path — left alone.
  const custom = planArtEdits({ ...base, existingLocalPath: "images/custom-name.webp" } as never);
  assert.equal(custom.jsonEdits.localPath, null);
  // Absent — filled.
  const absent = planArtEdits({ ...base, existingLocalPath: null } as never);
  assert.equal(absent.jsonEdits.localPath, "images/us-demo.webp");
});

