#!/usr/bin/env node
/**
 * Scaffold a new card JSON from templates/card.template.json.
 *
 *   npm run new:card -- --country us --slug my-card --name "My Card"
 *
 * Missing flags are asked for interactively. Pure helpers (slug/path/scaffold)
 * are exported so they can be unit-tested without touching the filesystem.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { repoRoot } from "./lib.ts";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const COUNTRY_RE = /^[a-z]{2}$/;

/** Lowercase, strip everything except [a-z0-9], collapse runs to single "-". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Repo-relative path for a card. Does not touch the filesystem. */
export function cardRelPath(country: string, slug: string): string {
  return `data/${country}/${slug}.json`;
}

export type ScaffoldOptions = {
  country: string;
  slug: string;
  name: string;
  today: string; // YYYY-MM-DD
};

/**
 * Copy the template and set only id/country/name/localized_names.en/last_verified.
 * Everything else stays template/null for a human to fill in.
 */
export function scaffoldFromTemplate(
  template: Record<string, unknown>,
  opts: ScaffoldOptions,
): Record<string, unknown> {
  const card = structuredClone(template);
  card.id = `${opts.country}-${opts.slug}`;
  card.country = opts.country;
  card.name = opts.name;
  const localized = card.localized_names;
  if (localized && typeof localized === "object") {
    (localized as Record<string, unknown>).en = opts.name;
  }
  card.last_verified = opts.today;
  return card;
}

type Flags = { country?: string; slug?: string; name?: string; help?: boolean };

export function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const [key, inlineValue] =
      arg.startsWith("--") && eq !== -1
        ? [arg.slice(2, eq), arg.slice(eq + 1)]
        : [arg.replace(/^--/, ""), undefined];
    const next = () => inlineValue ?? argv[++i] ?? "";
    switch (key) {
      case "country":
        out.country = next();
        break;
      case "slug":
        out.slug = next();
        break;
      case "name":
        out.name = next();
        break;
      case "help":
      case "h":
        out.help = true;
        break;
      default:
        break;
    }
  }
  return out;
}

const USAGE = `Usage: npm run new:card -- --country us --slug my-card --name "My Card"

Flags (any omitted flag is asked for interactively):
  --country   2-letter market code (us, ca, cn, …)
  --slug      lowercase [a-z0-9-] slug (defaults to a slug of the name)
  --name      card display name
  -h, --help  show this help`;

function die(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return;
  }

  let country = flags.country;
  let name = flags.name;
  let slug = flags.slug;

  const needsPrompt = !country || !name || !slug;
  if (needsPrompt) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!country) country = await rl.question("Country (us/ca/cn): ");
      if (!name) name = await rl.question("Card display name: ");
      if (!slug) {
        const suggested = slugify(name ?? "");
        const answer = (await rl.question(`Slug [${suggested}]: `)).trim();
        slug = answer || suggested;
      }
    } finally {
      rl.close();
    }
  }

  country = (country ?? "").trim().toLowerCase();
  name = (name ?? "").trim();
  slug = (slug ?? "").trim();

  if (!COUNTRY_RE.test(country)) {
    die(`--country must be a 2-letter lowercase code like us/ca/cn (got "${country}")`);
  }
  if (!name) die("--name (card display name) is required");
  if (!SLUG_RE.test(slug)) {
    die(`--slug must be lowercase [a-z0-9-] (got "${slug}"). Try "${slugify(slug || name)}"`);
  }

  const root = repoRoot();
  const rel = cardRelPath(country, slug);
  const target = path.join(root, rel);
  if (existsSync(target)) {
    die(`${rel} already exists — refusing to overwrite. Pick a different slug or edit that file.`);
  }

  const template = JSON.parse(
    await readFile(path.join(root, "templates/card.template.json"), "utf8"),
  ) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  const card = scaffoldFromTemplate(template, { country, slug, name, today });

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(card, null, 2) + "\n", "utf8");

  console.log(`created ${rel} (id: ${country}-${slug})`);
  console.log("next: fill fields, npm run validate");
}

const isDirectRun =
  process.argv[1] != null &&
  import.meta.url.endsWith(path.basename(process.argv[1]));
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
