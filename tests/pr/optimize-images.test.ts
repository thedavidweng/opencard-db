import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  optimizeImages,
  WEBP_EFFORT,
  WEBP_LOSSLESS,
} from "../../scripts/optimize-images.ts";

describe("optimize images", () => {
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
