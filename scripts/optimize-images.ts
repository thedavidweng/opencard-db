/**
 * Card-art SHA verification chain + lossless-WebP conversion.
 *
 * Normative source: Apple Pay `cardBackgroundCombined@2x.png`
 * (issuer digital wallet art, typically ~1536×969 lineage / Retina @2x).
 *
 * When a PR adds/changes a raster (`images/<card-id>.png` / `.jpg`), CI:
 *   1. VERIFY the contributor's claim. If the card JSON declares
 *      `image.provenance.source_sha256`, the sha256 of the submitted raster MUST
 *      match it (or an `alternate_sha256`) — mismatch is a hard error. A card
 *      with no provenance block is a warning, not a failure (issuer-site art has
 *      no Apple Pay lineage).
 *   2. CONVERT to lossless WebP at native dimensions (no downscale).
 *   3. ARCHIVE-ON-REPLACE. If `images/<card-id>.webp` already exists on the BASE
 *      branch, the old file is moved to `images/archive/<card-id>.<YYYYMMDD>.webp`
 *      (never overwritten) and an `image.history[]` entry recording the OLD art's
 *      provenance is appended.
 *   4. FILL `image.provenance.converted_sha256` (sha256 of the new WebP) and set
 *      `image.local_path` when absent.
 *
 * The pure decision logic (steps 1/3/4) lives in `planArtVerification` and is
 * unit-tested exhaustively. sharp / git / fs stay behind seams in `runArtChain`.
 *
 * Leaves README.md, SVG sources, and existing .webp alone.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

// ---------------------------------------------------------------------------
// Pure decision logic (steps 1, 3, 4). No I/O — exhaustively unit-tested.
// ---------------------------------------------------------------------------

export type ArtSource = "apple-pay" | "issuer-site" | "other";

/** The `image.provenance` block (schema.json $defs.artProvenance). */
export type ArtProvenance = {
  source: ArtSource;
  source_sha256: string;
  converted_sha256?: string | null;
  alternate_sha256?: string[];
  width?: number | null;
  height?: number | null;
  exported_at?: string | null;
};

/** One `image.history[]` entry (superseded art). */
export type ArtHistoryEntry = {
  local_path: string;
  source: ArtSource;
  source_sha256: string | null;
  superseded_at: string;
  note?: string | null;
};

export type VerifyStatus = "ok" | "mismatch" | "no-claim";

/** Declarative edits CI applies to the card JSON's `image` block. */
export type ArtJsonEdits = {
  /** Set `image.provenance.converted_sha256` (null = leave untouched). */
  convertedSha256: string | null;
  /** Set `image.local_path` when currently absent (null = leave as-is). */
  localPath: string | null;
  /** Append to `image.history[]` (null = none). */
  appendHistory: ArtHistoryEntry | null;
};

export type ArtVerifyPlan = {
  cardId: string;
  verify: VerifyStatus;
  /** Human-readable error (mismatch) or warning (no-claim); null when clean. */
  message: string | null;
  /** Repo-relative destination of the superseded base WebP (null = none). */
  archivePath: string | null;
  jsonEdits: ArtJsonEdits;
};

export type ArtVerifyInput = {
  cardId: string;
  /** sha256 of the submitted raster (PNG/JPG), hex. */
  submittedSha256: string;
  /** sha256 of the produced lossless WebP, hex. */
  convertedSha256: string;
  /** Repo-relative committed WebP path, e.g. `images/us-x.webp`. */
  webpPath: string;
  /** The contributor's claim on the HEAD card JSON (null = no block). */
  headProvenance: ArtProvenance | null;
  /** `image.local_path` currently on the HEAD card JSON. */
  existingLocalPath: string | null;
  /** provenance on the BASE-branch card JSON — describes the OLD art. */
  baseProvenance: ArtProvenance | null;
  /** Does `images/<card-id>.webp` already exist on the BASE branch? */
  baseWebpExists: boolean;
  /** Today, YYYY-MM-DD. */
  today: string;
};

const NO_EDITS: ArtJsonEdits = {
  convertedSha256: null,
  localPath: null,
  appendHistory: null,
};

/** `images/archive/<card-id>.<YYYYMMDD>.webp` for a given day. */
export function archivePathFor(cardId: string, today: string): string {
  const compact = today.replace(/-/g, "");
  return `images/archive/${cardId}.${compact}.webp`;
}

/**
 * Step 1: does the submitted raster match what the provenance block claims?
 * Pure. `no-claim` when there is no provenance block (warning, not failure).
 */
export function verifyClaim(
  submittedSha256: string,
  headProvenance: ArtProvenance | null,
  cardId = "card",
): { status: VerifyStatus; message: string | null } {
  if (headProvenance == null) {
    return {
      status: "no-claim",
      message:
        `${cardId}: no image.provenance block — the submitted raster cannot be ` +
        `verified against a declared hash. Issuer-site art has no Apple Pay ` +
        `lineage, so this is only a warning. To add verifiable provenance, run ` +
        "`npx opencard-export --repo .`.",
    };
  }
  const submitted = submittedSha256.toLowerCase();
  const claimed = [
    headProvenance.source_sha256,
    ...(headProvenance.alternate_sha256 ?? []),
  ].map((s) => s.toLowerCase());
  if (!claimed.includes(submitted)) {
    return {
      status: "mismatch",
      message:
        `${cardId}: the submitted file is not the one the provenance block ` +
        `describes — sha256 ${submitted} matches neither ` +
        `image.provenance.source_sha256 (${headProvenance.source_sha256}) nor ` +
        `any alternate_sha256. Re-export the art, or update the provenance ` +
        `block to match the file you committed.`,
    };
  }
  return { status: "ok", message: null };
}

/**
 * Steps 3 + 4: given a verified (or provenance-less) submission, decide the
 * archive path and the JSON edits. Pure.
 */
export function planArtEdits(input: ArtVerifyInput): {
  archivePath: string | null;
  jsonEdits: ArtJsonEdits;
} {
  const archivePath = input.baseWebpExists
    ? archivePathFor(input.cardId, input.today)
    : null;
  const appendHistory: ArtHistoryEntry | null = archivePath
    ? {
        local_path: archivePath,
        source: input.baseProvenance?.source ?? "other",
        source_sha256: input.baseProvenance?.source_sha256 ?? null,
        superseded_at: input.today,
        note: null,
      }
    : null;
  return {
    archivePath,
    jsonEdits: {
      // converted_sha256 has nowhere to live without a provenance block.
      convertedSha256: input.headProvenance ? input.convertedSha256 : null,
      localPath: input.existingLocalPath ? null : input.webpPath,
      appendHistory,
    },
  };
}

/**
 * The full plan for one submitted raster: verify (step 1) then, unless it is a
 * hard mismatch, the archive + JSON edits (steps 3/4). Pure — the star of the
 * unit tests.
 */
export function planArtVerification(input: ArtVerifyInput): ArtVerifyPlan {
  const v = verifyClaim(
    input.submittedSha256,
    input.headProvenance,
    input.cardId,
  );
  if (v.status === "mismatch") {
    return {
      cardId: input.cardId,
      verify: "mismatch",
      message: v.message,
      archivePath: null,
      jsonEdits: NO_EDITS,
    };
  }
  const { archivePath, jsonEdits } = planArtEdits(input);
  return {
    cardId: input.cardId,
    verify: v.status,
    message: v.message,
    archivePath,
    jsonEdits,
  };
}

/**
 * Apply the planned edits to an `image` object. Pure — returns the (possibly
 * new) image value and whether anything changed. Creates the `image` object
 * when it was null and there is something to set.
 */
export function applyArtJsonEdits(
  image: Record<string, unknown> | null | undefined,
  edits: ArtJsonEdits,
): { image: Record<string, unknown> | null; changed: boolean } {
  const hasWork =
    edits.convertedSha256 != null ||
    edits.localPath != null ||
    edits.appendHistory != null;
  if (!hasWork) return { image: image ?? null, changed: false };

  const next: Record<string, unknown> =
    image && typeof image === "object" ? { ...image } : {};
  let changed = image == null || typeof image !== "object";

  if (edits.convertedSha256 != null) {
    const prov = next.provenance;
    if (prov && typeof prov === "object") {
      const p = { ...(prov as Record<string, unknown>) };
      if (p.converted_sha256 !== edits.convertedSha256) {
        p.converted_sha256 = edits.convertedSha256;
        next.provenance = p;
        changed = true;
      }
    }
  }
  if (edits.localPath != null && next.local_path !== edits.localPath) {
    next.local_path = edits.localPath;
    changed = true;
  }
  if (edits.appendHistory != null) {
    const history = Array.isArray(next.history) ? [...next.history] : [];
    history.push(edits.appendHistory);
    next.history = history;
    changed = true;
  }
  return { image: next, changed };
}

/** sha256 hex of a buffer. */
export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Surgically replace the top-level `"image":` block of a pretty-printed
 * (2-space) card JSON with `newImage`, preserving the rest of the file
 * byte-for-byte (blank-line section separators included). Cards are written
 * with `JSON.stringify(card, null, 2) + "\n"` (see scripts/new-card.ts), so the
 * top-level value indents at 2 spaces and nested lines at ≥4.
 */
export function replaceImageBlock(
  raw: string,
  newImage: Record<string, unknown> | null,
): string {
  const lines = raw.split("\n");
  const startIdx = lines.findIndex((l) => /^ {2}"image"\s*:/.test(l));
  if (startIdx === -1) {
    throw new Error("card JSON has no top-level image property to update");
  }
  const startLine = lines[startIdx];
  const opensMultiline = /\{\s*$/.test(startLine);
  let endIdx = startIdx;
  if (opensMultiline) {
    // The value's closing brace is the first later line at 2-space indent.
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^ {2}\}(,?)\s*$/.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
  }
  const trailingComma = /,\s*$/.test(lines[endIdx]);
  const body = JSON.stringify(newImage, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n");
  const rebuilt = `  "image": ${body}${trailingComma ? "," : ""}`;
  return [
    ...lines.slice(0, startIdx),
    ...rebuilt.split("\n"),
    ...lines.slice(endIdx + 1),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// I/O seams (sharp / git). Injectable so the chain is testable.
// ---------------------------------------------------------------------------

/** Convert a raster to lossless WebP at native dimensions. */
export async function convertToWebp(
  rasterAbs: string,
  webpAbs: string,
): Promise<void> {
  const img = sharp(rasterAbs, { failOn: "none" });
  const tmp = `${webpAbs}.tmp`;
  await img.webp({ lossless: WEBP_LOSSLESS, effort: WEBP_EFFORT }).toFile(tmp);
  await rename(tmp, webpAbs);
}

function gitShowText(sha: string, repoRelPath: string): string | null {
  try {
    return execFileSync("git", ["show", `${sha}:${repoRelPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function gitShowBuffer(sha: string, repoRelPath: string): Buffer | null {
  try {
    return execFileSync("git", ["show", `${sha}:${repoRelPath}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

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

/**
 * Plain bulk converter: every raster under `dir` → lossless WebP, native size.
 * Kept for local use and the conversion unit tests; carries no verification /
 * archive logic (that lives in `runArtChain`, which needs the repo + git base).
 */
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
      await convertToWebp(file, outPath);
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

export type ArtChainDeps = {
  repoRoot: string;
  today: string;
  /** BASE commit sha (empty = base unavailable; skips archive + base lookups). */
  baseSha: string;
  readBaseText: (sha: string, repoRelPath: string) => string | null;
  readBaseBuffer: (sha: string, repoRelPath: string) => Buffer | null;
  convert: (rasterAbs: string, webpAbs: string) => Promise<void>;
};

export type ArtChainResult = {
  plans: ArtVerifyPlan[];
  errors: string[];
  warnings: string[];
  written: string[];
  removed: string[];
  archived: string[];
  editedCards: string[];
};

/** Locate + parse the HEAD card JSON for a card id (data/<cc>/<slug>.json). */
async function loadHeadCard(
  dataDir: string,
  cardId: string,
): Promise<{
  file: string;
  image: Record<string, unknown> | null;
} | null> {
  const m = cardId.match(/^([a-z]{2})-(.+)$/);
  if (!m) return null;
  const file = path.join(dataDir, m[1], `${m[2]}.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return null;
  }
  let card: Record<string, unknown>;
  try {
    card = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const image = card.image;
  return {
    file,
    image: image && typeof image === "object"
      ? (image as Record<string, unknown>)
      : null,
  };
}

function provenanceOf(raw: string | null): ArtProvenance | null {
  if (raw == null) return null;
  try {
    const card = JSON.parse(raw) as {
      image?: { provenance?: ArtProvenance | null } | null;
    };
    return card.image?.provenance ?? null;
  } catch {
    return null;
  }
}

/**
 * The full card-art chain over every raster under `images/`. Verifies, converts,
 * archives-on-replace and fills provenance/local_path. I/O is injected so this
 * is exercised end-to-end in tests with fake git + a real sharp convert.
 */
export async function runArtChain(deps: ArtChainDeps): Promise<ArtChainResult> {
  const imgDir = path.join(deps.repoRoot, "images");
  const dataDir = path.join(deps.repoRoot, "data");
  const result: ArtChainResult = {
    plans: [],
    errors: [],
    warnings: [],
    written: [],
    removed: [],
    archived: [],
    editedCards: [],
  };
  await mkdir(imgDir, { recursive: true });
  const files = await listFiles(imgDir);

  for (const file of files) {
    const base = path.basename(file);
    if (base === "README.md" || base.startsWith(".")) continue;
    if (!RASTER.test(file)) continue; // .webp / svg: leave alone

    const cardId = base.replace(RASTER, "");
    const submittedSha256 = sha256(await readFile(file));
    const head = await loadHeadCard(dataDir, cardId);
    const headProvenance = (head?.image?.provenance ??
      null) as ArtProvenance | null;
    const existingLocalPath =
      typeof head?.image?.local_path === "string"
        ? (head.image.local_path as string)
        : null;

    // Step 1 — verify BEFORE converting so a mismatch never mutates the tree.
    const claim = verifyClaim(submittedSha256, headProvenance, cardId);
    if (claim.status === "mismatch") {
      result.errors.push(claim.message ?? `${cardId}: provenance mismatch`);
      result.plans.push({
        cardId,
        verify: "mismatch",
        message: claim.message,
        archivePath: null,
        jsonEdits: NO_EDITS,
      });
      continue;
    }

    // Step 2 — convert.
    const webpAbs = file.replace(RASTER, ".webp");
    await deps.convert(file, webpAbs);
    result.written.push(webpAbs);
    await rm(file);
    result.removed.push(file);
    const convertedSha256 = sha256(await readFile(webpAbs));

    // Steps 3/4 — base-branch state → archive + JSON edits.
    const webpRepoRel = path.relative(deps.repoRoot, webpAbs);
    const baseWebpBuf = deps.baseSha
      ? deps.readBaseBuffer(deps.baseSha, webpRepoRel)
      : null;
    const baseProvenance =
      deps.baseSha && head
        ? provenanceOf(
            deps.readBaseText(
              deps.baseSha,
              path.relative(deps.repoRoot, head.file),
            ),
          )
        : null;

    const plan = planArtVerification({
      cardId,
      submittedSha256,
      convertedSha256,
      webpPath: webpRepoRel,
      headProvenance,
      existingLocalPath,
      baseProvenance,
      baseWebpExists: baseWebpBuf != null,
      today: deps.today,
    });
    result.plans.push(plan);
    if (plan.verify === "no-claim" && plan.message) {
      result.warnings.push(plan.message);
    }

    // Archive-on-replace: write the OLD (base) WebP to images/archive/…
    if (plan.archivePath && baseWebpBuf) {
      const archiveAbs = path.join(deps.repoRoot, plan.archivePath);
      await mkdir(path.dirname(archiveAbs), { recursive: true });
      await writeFile(archiveAbs, baseWebpBuf);
      result.archived.push(plan.archivePath);
    }

    // Fill converted_sha256 / local_path / history on the card JSON.
    if (head) {
      const { image, changed } = applyArtJsonEdits(head.image, plan.jsonEdits);
      if (changed) {
        const raw = await readFile(head.file, "utf8");
        await writeFile(head.file, replaceImageBlock(raw, image));
        result.editedCards.push(head.file);
      }
    }
  }
  return result;
}

function annotate(kind: "error" | "warning", msg: string): void {
  const flat = msg.replace(/\n/g, " ");
  if (process.env.GITHUB_ACTIONS) console.log(`::${kind}::${flat}`);
  else if (kind === "error") console.error(`error: ${flat}`);
  else console.warn(`warning: ${flat}`);
}

async function main(): Promise<void> {
  const res = await runArtChain({
    repoRoot: root,
    today: new Date().toISOString().slice(0, 10),
    baseSha: process.env.BASE_SHA ?? "",
    readBaseText: gitShowText,
    readBaseBuffer: gitShowBuffer,
    convert: convertToWebp,
  });

  for (const w of res.warnings) annotate("warning", w);
  for (const e of res.errors) annotate("error", e);

  const rel = (p: string) => path.relative(root, p);
  const out = {
    written: res.written.map(rel),
    removed: res.removed.map(rel),
    archived: res.archived,
    edited: res.editedCards.map(rel),
    verifications: res.plans.map((p) => ({ card: p.cardId, verify: p.verify })),
  };

  // In CI the JSON goes to a file so `::error::`/`::warning::` workflow commands
  // own stdout (and become PR annotations); locally it prints to stdout.
  const jsonOut = process.env.OPTIMIZE_JSON_OUT;
  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify(out, null, 2));
    console.log(
      `optimize-images: ${out.written.length} converted, ` +
        `${out.archived.length} archived, ${out.edited.length} card(s) edited, ` +
        `${res.errors.length} error(s), ${res.warnings.length} warning(s)`,
    );
  } else {
    console.log(JSON.stringify(out, null, 2));
  }

  if (res.errors.length > 0) process.exit(1);
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
