/**
 * Optimize card face images under images/ to lossless WebP.
 *
 * Normative source: Apple Pay `cardBackgroundCombined@2x.png`
 * (issuer digital wallet art, typically ~1536×969 lineage / Retina @2x).
 * Convert raster uploads → lossless WebP at native dimensions (no downscale).
 *
 * Leaves README.md, SVG sources, and existing .webp alone.
 */
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imagesDir = path.join(root, "images");

/** Lossless WebP — preserve Apple Pay @2x fidelity. */
export const WEBP_LOSSLESS = true;
/** sharp effort 0–6; higher = smaller lossless files, slower CI. */
export const WEBP_EFFORT = 6;
const RASTER = /\.(png|jpe?g|gif|tiff?)$/i;

export type OptimizeResult = {
  written: string[];
  removed: string[];
  skipped: string[];
};

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await listFiles(p)));
      else out.push(p);
    }
    return out;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw err;
  }
}

export async function optimizeImages(
  dir: string = imagesDir,
): Promise<OptimizeResult> {
  const written: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];
  await mkdir(dir, { recursive: true });
  const files = await listFiles(dir);

  for (const file of files) {
    const base = path.basename(file);
    if (base === "README.md" || base.startsWith(".")) {
      skipped.push(file);
      continue;
    }

    if (RASTER.test(file)) {
      const outPath = file.replace(RASTER, ".webp");
      const img = sharp(file, { failOn: "none" });
      const tmp = `${outPath}.tmp`;
      // Native dimensions — do not resize; Apple Pay @2x is the quality bar.
      await img.webp({ lossless: WEBP_LOSSLESS, effort: WEBP_EFFORT }).toFile(tmp);
      await rename(tmp, outPath);
      written.push(outPath);
      await rm(file);
      removed.push(file);
      continue;
    }

    // Existing WebP (including default-card.webp): leave untouched.
    skipped.push(file);
  }

  return { written, removed, skipped };
}

async function main(): Promise<void> {
  const result = await optimizeImages();
  console.log(
    JSON.stringify(
      {
        written: result.written.map((p) => path.relative(root, p)),
        removed: result.removed.map((p) => path.relative(root, p)),
        skipped: result.skipped.map((p) => path.relative(root, p)),
      },
      null,
      2,
    ),
  );
}

const isDirectRun = /scripts\/optimize-images\.(ts|js|mjs)$/.test(
  process.argv[1] ?? "",
);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
