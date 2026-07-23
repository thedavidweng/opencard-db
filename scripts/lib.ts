import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Card = {
  id: string;
  country: string;
  issuer_id: string;
  network: string;
  network_tier: string;
  status: string;
  name: string;
  [key: string]: unknown;
};

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function repoRoot(): string {
  return rootDir;
}

export async function loadSchema(): Promise<object> {
  const raw = await readFile(path.join(rootDir, "schema.json"), "utf8");
  return JSON.parse(raw) as object;
}

export async function listCardFiles(): Promise<string[]> {
  const dataDir = path.join(rootDir, "data");
  const countries = await readdir(dataDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of countries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const countryDir = path.join(dataDir, entry.name);
    const names = await readdir(countryDir);
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      files.push(path.join(countryDir, name));
    }
  }
  return files.sort();
}

export async function loadAllCards(): Promise<
  { file: string; card: Card }[]
> {
  const files = await listCardFiles();
  const out: { file: string; card: Card }[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    out.push({ file, card: JSON.parse(raw) as Card });
  }
  return out;
}

export function expectedIdFromPath(file: string): {
  country: string;
  slug: string;
  id: string;
} {
  const country = path.basename(path.dirname(file));
  const slug = path.basename(file, ".json");
  return { country, slug, id: `${country}-${slug}` };
}
