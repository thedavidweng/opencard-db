/**
 * Optimize card face images under images/ to WebP.
 * - Max width 800px
 * - WebP quality ~80
 * - Writes `{basename}.webp` next to / replacing raster uploads
 * - Leaves README.md alone
 */
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imagesDir = path.join(root, "images");
const MAX_WIDTH = 800;
const WEBP_QUALITY = 80;
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
      const meta = await img.metadata();
      const width = meta.width ?? MAX_WIDTH;
      const pipeline =
        width > MAX_WIDTH
          ? img.resize({ width: MAX_WIDTH, withoutEnlargement: true })
          : img;
      const tmp = `${outPath}.tmp`;
      await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toFile(tmp);
      await rename(tmp, outPath);
      written.push(outPath);
      await rm(file);
      removed.push(file);
      continue;
    }

    if (file.toLowerCase().endsWith(".webp")) {
      const meta = await sharp(file, { failOn: "none" }).metadata();
      const width = meta.width ?? 0;
      const st = await stat(file);
      if (width > MAX_WIDTH || st.size > 350_000) {
        const img = sharp(file, { failOn: "none" });
        const pipeline =
          width > MAX_WIDTH
            ? img.resize({ width: MAX_WIDTH, withoutEnlargement: true })
            : img;
        const tmp = `${file}.tmp`;
        await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toFile(tmp);
        await rename(tmp, file);
        written.push(file);
      } else {
        skipped.push(file);
      }
      continue;
    }

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
