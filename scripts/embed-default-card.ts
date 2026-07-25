/**
 * Regenerate images/default-card.webp and worker/src/default-card-asset.ts
 * from images/default-card.svg. Requires optional peer: npm i -D sharp
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "images/default-card.svg");
const webpPath = join(root, "images/default-card.webp");
const outTs = join(root, "worker/src/default-card-asset.ts");

async function main() {
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    console.error(
      "sharp is required to regenerate the default card. Run: npm i -D sharp",
    );
    process.exit(1);
  }

  const svg = readFileSync(svgPath);
  const webp = await sharp(svg).webp({ quality: 82 }).toBuffer();
  writeFileSync(webpPath, webp);

  const b64 = webp.toString("base64");
  writeFileSync(
    outTs,
    `/** Auto-generated from images/default-card.webp — run scripts/embed-default-card.ts to refresh. */\n` +
      `export const DEFAULT_CARD_WEBP_BASE64 = ${JSON.stringify(b64)};\n` +
      `export const DEFAULT_CARD_CONTENT_TYPE = "image/webp";\n`,
  );
  console.log(`Wrote ${webpPath} (${webp.byteLength} bytes) and ${outTs}`);
}

main();
