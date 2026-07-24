import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { optimizeImages } from "../../scripts/optimize-images.ts";
import { existsSync } from "node:fs";

function tinyPng(): Buffer {
  // Precomputed valid 1x1 PNG
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

describe("optimize images", () => {
  it("converts png uploads to webp", async () => {
    const dir = path.join("/tmp", `opencard-img-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const png = path.join(dir, "us-demo-card.png");
    await writeFile(png, tinyPng());
    const result = await optimizeImages(dir);
    assert.equal(result.written.length, 1);
    assert.ok(result.written[0].endsWith(".webp"));
    assert.ok(existsSync(result.written[0]));
    assert.equal(existsSync(png), false);
    await rm(dir, { recursive: true, force: true });
  });
});
