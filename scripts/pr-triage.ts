/**
 * PR contribution helpers for Labels + Form check CI.
 * Beginner-friendly messages; safe to unit-test without network.
 */

export type OpenPrHint = {
  number: number;
  title: string;
  url: string;
  author?: string;
};

export type BaseCardSnapshot = {
  /** Path under repo, e.g. data/us/foo.json */
  path: string;
  exists: boolean;
  last_verified: string | null;
};

export type FormIssue = {
  code: string;
  severity: "error" | "warn";
  /** Markdown-friendly beginner guidance (one bullet). */
  message: string;
};

export type TriageInput = {
  title: string;
  body: string;
  changedFiles: string[];
  /** This PR’s number — excluded from duplicate search. */
  currentPrNumber?: number;
  /** Other open PRs (title/url) for duplicate detection. */
  openCardPrs?: OpenPrHint[];
  /** Base-branch snapshots keyed by repo-relative path. */
  baseCards?: Record<string, BaseCardSnapshot>;
};

export type TriageResult = {
  titleOk: boolean;
  titleKind: "add-card" | "update-card" | "meta" | "invalid";
  titleMessage: string;
  suggestedTitle: string | null;
  regions: Array<"US" | "CA" | "CN">;
  isCardPr: boolean;
  isNewCard: boolean;
  /** Card ids inferred from title / form / data paths. */
  cardIds: string[];
  /** Error messages (legacy + beginner copy). Fail Form check when non-empty. */
  missing: string[];
  issues: FormIssue[];
  duplicatePrs: OpenPrHint[];
  classificationLabelsAdd: string[];
  classificationLabelsRemove: string[];
  completenessLabelsAdd: string[];
  completenessLabelsRemove: string[];
  labelsAdd: string[];
  labelsRemove: string[];
  commentMarkdown: string;
};

export const CLASSIFICATION_LABELS = [
  "US",
  "CA",
  "CN",
  "new-card",
  "enhancement",
  "documentation",
] as const;

export const COMPLETENESS_LABELS = [
  "needs-info",
  "pr-form-incomplete",
  "missing-sources",
  "title-needs-fix",
  "duplicate",
] as const;

/** Preferred: Conventional Commits with type `card` + scope add|update. */
const CARD_TITLE =
  /^card\((add|update)\):\s*([a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$/i;
/** Legacy prose titles — still accepted so open PRs keep working. */
const CARD_TITLE_LEGACY =
  /^(Add|Update) card:\s*([a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** Conventional Commits for non-card work (`card` is reserved — use card(add|update):). */
const CONVENTIONAL_TYPES =
  "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert";
const CONVENTIONAL_TITLE = new RegExp(
  String.raw`^(${CONVENTIONAL_TYPES})(\([a-z0-9][a-z0-9._/-]*\))?(!)?:\s\S.+`,
  "i",
);

const TITLE_HELP =
  "One Conventional Commits system for every PR: " +
  "cards use `card(add): us-my-card` / `card(update): us-my-card`; " +
  "everything else uses `feat:` / `fix:` / `docs:` / `ci:` / … " +
  "(optional scope, e.g. `feat(pr-checks): …`).";

export function formatCardTitle(
  kind: "add" | "update",
  cardId: string,
): string {
  return `card(${kind}): ${cardId}`;
}

export function parseCardTitle(title: string): {
  kind: "add-card" | "update-card";
  cardId: string;
  legacy: boolean;
} | null {
  const t = title.trim();
  const modern = t.match(CARD_TITLE);
  if (modern) {
    return {
      kind: modern[1].toLowerCase() === "add" ? "add-card" : "update-card",
      cardId: modern[2].toLowerCase(),
      legacy: false,
    };
  }
  const legacy = t.match(CARD_TITLE_LEGACY);
  if (legacy) {
    return {
      kind: legacy[1] === "Add" ? "add-card" : "update-card",
      cardId: legacy[2].toLowerCase(),
      legacy: true,
    };
  }
  return null;
}
const CARD_ID_RE = /^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PLACEHOLDER_RE =
  /example|your-card|your_|placeholder|todo|tbd|xxxx|https:\/\/www\.example/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read a `**Label:** value` form field (same line only).
 */
export function field(body: string, label: string): string | null {
  const re = new RegExp(
    String.raw`\*\*${escapeRegExp(label)}:\*\*[ \t]*(?:` +
      String.raw`\`([^\`\n]*)\`|([^\n]*))`,
    "i",
  );
  const m = body.match(re);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? "").trim();
  const cleaned = raw.replace(/<!--[\s\S]*$/, "").trim();
  if (
    !cleaned ||
    cleaned === "_" ||
    cleaned === "-" ||
    cleaned === "_(leave empty)_"
  ) {
    return "";
  }
  return cleaned;
}

function checkboxChecked(body: string, text: string): boolean {
  const re = new RegExp(
    String.raw`- \[x\]\s*.*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "i",
  );
  return re.test(body);
}

export function detectRegions(changedFiles: string[]): Array<"US" | "CA" | "CN"> {
  const set = new Set<"US" | "CA" | "CN">();
  for (const f of changedFiles) {
    if (f.startsWith("data/us/") || f.startsWith("images/us-")) set.add("US");
    if (f.startsWith("data/ca/") || f.startsWith("images/ca-")) set.add("CA");
    if (f.startsWith("data/cn/") || f.startsWith("images/cn-")) set.add("CN");
  }
  return [...set];
}

export function parseTitle(title: string): {
  ok: boolean;
  kind: TriageResult["titleKind"];
  message: string;
  cardId: string | null;
} {
  const t = title.trim();
  const card = parseCardTitle(t);
  if (card) {
    return {
      ok: true,
      kind: card.kind,
      message: card.legacy
        ? "Title matches legacy card format (prefer `card(add|update): …`)."
        : "Title matches Conventional Commits card format.",
      cardId: card.cardId,
    };
  }
  // Reject bare `card:` / wrong scope so people don't invent formats.
  if (/^card(\b|\()/i.test(t)) {
    return {
      ok: false,
      kind: "invalid",
      message:
        "Card titles must be `card(add): us-my-card` or `card(update): us-my-card` (Conventional Commits type `card` + scope).",
      cardId: null,
    };
  }
  if (CONVENTIONAL_TITLE.test(t)) {
    return {
      ok: true,
      kind: "meta",
      message: "Title matches Conventional Commits (non-card).",
      cardId: null,
    };
  }
  return {
    ok: false,
    kind: "invalid",
    message: TITLE_HELP,
    cardId: null,
  };
}

export function suggestTitle(
  changedFiles: string[],
  body: string,
): string | null {
  const kind: "add" | "update" = checkboxChecked(body, "Update existing card")
    ? "update"
    : "add";
  const fromField = field(body, "Card ID");
  if (fromField && !PLACEHOLDER_RE.test(fromField) && CARD_ID_RE.test(fromField)) {
    return formatCardTitle(kind, fromField);
  }
  for (const f of changedFiles) {
    const m = f.match(/^data\/([a-z]{2})\/([a-z0-9-]+)\.json$/);
    if (m) return formatCardTitle(kind, `${m[1]}-${m[2]}`);
  }
  return null;
}

function isPlaceholder(value: string | null): boolean {
  if (value == null) return true;
  if (value === "") return true;
  if (value.toLowerCase() === "unknown") return false;
  return PLACEHOLDER_RE.test(value);
}

export function dataCardPaths(changedFiles: string[]): string[] {
  return changedFiles.filter((f) =>
    /^data\/[a-z]{2}\/[a-z0-9-]+\.json$/.test(f),
  );
}

export function cardIdFromDataPath(path: string): string | null {
  const m = path.match(/^data\/([a-z]{2})\/([a-z0-9-]+)\.json$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function findDuplicatePrs(
  cardIds: string[],
  openPrs: OpenPrHint[],
  currentPrNumber?: number,
): OpenPrHint[] {
  if (cardIds.length === 0) return [];
  const ids = new Set(cardIds.map((id) => id.toLowerCase()));
  const out: OpenPrHint[] = [];
  const seen = new Set<number>();
  for (const pr of openPrs) {
    if (currentPrNumber != null && pr.number === currentPrNumber) continue;
    if (seen.has(pr.number)) continue;
    const parsed = parseCardTitle(pr.title);
    const titleId = parsed?.cardId;
    // Exact card-id match only: substring matching false-positives on
    // prefix-collision slugs (us-amex-gold vs us-amex-gold-star).
    const hit = titleId != null && ids.has(titleId);
    if (hit) {
      seen.add(pr.number);
      out.push(pr);
    }
  }
  return out;
}

/** Compare ISO dates as YYYY-MM-DD strings. */
export function compareIsoDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function pushIssue(issues: FormIssue[], issue: FormIssue): void {
  issues.push(issue);
}

function collectCardIds(
  titleInfo: ReturnType<typeof parseTitle>,
  body: string,
  paths: string[],
): string[] {
  const ids = new Set<string>();
  if (titleInfo.cardId) ids.add(titleInfo.cardId);
  const formId = field(body, "Card ID");
  if (formId && CARD_ID_RE.test(formId) && !isPlaceholder(formId)) {
    ids.add(formId);
  }
  for (const p of paths) {
    const id = cardIdFromDataPath(p);
    if (id) ids.add(id);
  }
  return [...ids];
}

export function triagePullRequest(input: TriageInput): TriageResult {
  const {
    title,
    body,
    changedFiles,
    currentPrNumber,
    openCardPrs = [],
    baseCards = {},
  } = input;
  const titleInfo = parseTitle(title);
  const suggestedTitle = suggestTitle(changedFiles, body);
  const regions = detectRegions(changedFiles);
  const paths = dataCardPaths(changedFiles);
  // Maintenance escape: a bulk data change (backfills, registry migrations)
  // legitimately touches many card files but is not a card contribution —
  // "Not a card" checked + a non-card Conventional Commits title skips the
  // card form and the one-card-per-PR rule (validate still gates the data).
  const isMaintenance =
    checkboxChecked(body, "Not a card") &&
    titleInfo.kind === "meta" &&
    !checkboxChecked(body, "New card") &&
    !checkboxChecked(body, "Update existing card");
  const isCardPr =
    !isMaintenance &&
    (paths.length > 0 ||
      checkboxChecked(body, "New card") ||
      checkboxChecked(body, "Update existing card") ||
      titleInfo.kind === "add-card" ||
      titleInfo.kind === "update-card");
  const isNewCard =
    titleInfo.kind === "add-card" || checkboxChecked(body, "New card");
  const isUpdateCard =
    titleInfo.kind === "update-card" ||
    checkboxChecked(body, "Update existing card");

  const cardIds = collectCardIds(titleInfo, body, paths);
  const issues: FormIssue[] = [];
  const missing: string[] = [];

  const note = (issue: FormIssue) => {
    pushIssue(issues, issue);
    if (issue.severity === "error") missing.push(issue.message);
  };

  if (!titleInfo.ok) {
    note({
      code: "title-format",
      severity: "error",
      message: suggestedTitle
        ? `PR title format looks wrong. Try renaming the title to \`${suggestedTitle}\` (copy-paste is fine).`
        : `PR title format looks wrong. ${TITLE_HELP}`,
    });
  }

  if (isMaintenance && paths.length > 0) {
    note({
      code: "maintenance-bulk-data",
      severity: "warn",
      message: `Maintenance PR touching **${paths.length}** card JSON file(s) — card form checks skipped ("Not a card" + non-card title). \`validate\` still gates the data.`,
    });
  }

  if (isCardPr && paths.length > 1) {
    note({
      code: "one-card-per-pr",
      severity: "error",
      message: `This PR changes **${paths.length}** card JSON files (${paths.map((p) => `\`${p}\``).join(", ")}). Please open **one PR per card** so reviewers can check Sources easily.`,
    });
  }

  if (isCardPr) {
    const cardId = field(body, "Card ID");
    const product = field(body, "Product page");
    const terms = field(body, "Terms / benefits page");
    const verified = field(body, "Last verified (YYYY-MM-DD)");
    const imageUrl = field(body, "Image URL");
    const localPath = field(body, "Local path after upload");
    const noImage = checkboxChecked(body, "No image yet");
    const optOfficial =
      checkboxChecked(body, "A. Official issuer image URL") ||
      checkboxChecked(body, "A. Official image URL");
    const optApplePay = checkboxChecked(body, "B. Apple Pay extract");
    const optOtherUpload =
      checkboxChecked(body, "C. Other local upload") ||
      checkboxChecked(body, "B. Upload a local file");

    if (isPlaceholder(cardId)) {
      note({
        code: "card-id",
        severity: "error",
        message:
          "Fill in **Card ID** (for example `us-chase-sapphire-preferred`). Keep the backticks. Don’t leave the template example value.",
      });
    } else if (cardId && !CARD_ID_RE.test(cardId)) {
      note({
        code: "card-id-format",
        severity: "error",
        message: `**Card ID** \`${cardId}\` should look like \`us-my-card\` (lowercase country + slug).`,
      });
    }

    // Title / form / path consistency
    if (
      titleInfo.cardId &&
      cardId &&
      !isPlaceholder(cardId) &&
      titleInfo.cardId !== cardId
    ) {
      note({
        code: "card-id-mismatch-title",
        severity: "error",
        message: `Title says \`${titleInfo.cardId}\` but the form **Card ID** is \`${cardId}\`. Make them the same.`,
      });
    }
    for (const p of paths) {
      const pathId = cardIdFromDataPath(p);
      if (pathId && cardId && !isPlaceholder(cardId) && pathId !== cardId) {
        note({
          code: "card-id-mismatch-path",
          severity: "error",
          message: `File \`${p}\` implies id \`${pathId}\`, but the form **Card ID** is \`${cardId}\`. Rename the file or fix the form so they match (\`data/{country}/{slug}.json\` ↔ \`{country}-{slug}\`).`,
        });
      }
      if (pathId && titleInfo.cardId && pathId !== titleInfo.cardId) {
        note({
          code: "card-id-mismatch-title-path",
          severity: "error",
          message: `Title says \`${titleInfo.cardId}\` but the JSON path is \`${p}\` (id \`${pathId}\`). Align title, file path, and Card ID.`,
        });
      }
    }

    if (isPlaceholder(product) && isPlaceholder(terms)) {
      note({
        code: "sources",
        severity: "error",
        message:
          "Add at least one **official** URL under **Product page** or **Terms / benefits page** (the bank’s own site — not a blog or the example-bank.com placeholder).",
      });
    }

    if (
      !verified ||
      isPlaceholder(verified) ||
      verified === "YYYY-MM-DD" ||
      !DATE_RE.test(verified)
    ) {
      note({
        code: "last-verified",
        severity: "error",
        message:
          "Set **Last verified (YYYY-MM-DD)** to the date you checked the official pages (today is fine), like `2026-07-24`. Don’t leave `YYYY-MM-DD`.",
      });
    }

    const hasImageFile = changedFiles.some((f) =>
      /^images\/.+\.(png|jpe?g|gif|webp)$/i.test(f),
    );
    const localUploadOk =
      hasImageFile || (localPath != null && !isPlaceholder(localPath));
    const hasImage =
      noImage ||
      (optOfficial && imageUrl != null && !isPlaceholder(imageUrl)) ||
      (optApplePay && localUploadOk) ||
      (optOtherUpload && localUploadOk) ||
      (imageUrl != null && !isPlaceholder(imageUrl)) ||
      hasImageFile;
    if (!hasImage) {
      note({
        code: "image",
        severity: "error",
        message:
          "Pick a card image option: **A** official URL, **B** Apple Pay extract, **C** other upload, or check **D. No image yet** if you’ll add art later.",
      });
    }

    if (paths.length === 0 && isNewCard) {
      note({
        code: "missing-json",
        severity: "error",
        message:
          "Add a JSON file under `data/us/`, `data/ca/`, or `data/cn/` (copy `templates/card.template.json` and rename it). New-card PRs need that file.",
      });
    }

    // Add vs Update vs what exists on the base branch
    for (const p of paths) {
      const base = baseCards[p];
      if (!base) continue;
      const pathId = cardIdFromDataPath(p) ?? p;
      if (isNewCard && base.exists) {
        note({
          code: "already-exists",
          severity: "error",
          message: `Card \`${pathId}\` **already exists** on the base branch (\`${p}\`). This should be an **update** PR — change the title to \`${formatCardTitle("update", pathId)}\` and check **Update existing card** instead of opening a second add.`,
        });
      }
      if (isUpdateCard && !isNewCard && !base.exists) {
        note({
          code: "does-not-exist",
          severity: "error",
          message: `Card \`${pathId}\` is **not** on the base branch yet (\`${p}\` is new). Use title \`${formatCardTitle("add", pathId)}\` and check **New card**.`,
        });
      }

      // last_verified must move forward on updates
      if (
        (isUpdateCard || (base.exists && !isNewCard)) &&
        base.exists &&
        verified &&
        DATE_RE.test(verified) &&
        base.last_verified &&
        DATE_RE.test(base.last_verified)
      ) {
        const cmp = compareIsoDates(verified, base.last_verified);
        if (cmp < 0) {
          note({
            code: "last-verified-older",
            severity: "error",
            message: `**Last verified** in the form is \`${verified}\`, but the card on the base branch already has \`${base.last_verified}\`. Use a date **on or after** \`${base.last_verified}\` (usually today’s date when you re-checked the bank site).`,
          });
        } else if (cmp === 0) {
          note({
            code: "last-verified-unchanged",
            severity: "error",
            message: `**Last verified** is still \`${verified}\` — the same as the base branch. For an update, set it to the day you re-checked the official Sources (must be **newer** than \`${base.last_verified}\`).`,
          });
        }
      }
    }

    // Also compare form last_verified when path known via card id mapping
    if (
      isUpdateCard &&
      verified &&
      DATE_RE.test(verified) &&
      paths.length === 0
    ) {
      note({
        code: "update-missing-json",
        severity: "warn",
        message:
          "This looks like an **Update** PR but no `data/{country}/{slug}.json` file changed. Make sure you edited the existing card JSON (not only the PR form).",
      });
    }

    if (isNewCard && isUpdateCard && titleInfo.kind === "invalid") {
      // both checkboxes — rare
      note({
        code: "add-and-update-checked",
        severity: "warn",
        message:
          "Both **New card** and **Update existing card** are checked. Pick one so Labels and reviewers know which workflow to use.",
      });
    }
  }

  const duplicatePrs = findDuplicatePrs(cardIds, openCardPrs, currentPrNumber);
  if (duplicatePrs.length > 0 && (isNewCard || isCardPr)) {
    for (const dup of duplicatePrs) {
      const who = dup.author ? ` (@${dup.author})` : "";
      // warn, not error: the open-PR list is best-effort (may be stale or
      // empty on API failure), so a possible duplicate should not hard-fail
      // a legitimate PR — it labels and comments instead.
      note({
        code: "duplicate-pr",
        severity: "warn",
        message: `Possible **duplicate**: open PR [#${dup.number}](${dup.url}) — “${dup.title.replace(/"/g, "'")}”${who}. Please coordinate there or close this PR instead of adding the same card twice.`,
      });
    }
  }

  const classificationLabelsAdd: string[] = [];
  const classificationLabelsRemove: string[] = [];

  for (const r of ["US", "CA", "CN"] as const) {
    if (regions.includes(r)) classificationLabelsAdd.push(r);
    else classificationLabelsRemove.push(r);
  }

  if (isNewCard) classificationLabelsAdd.push("new-card");
  else classificationLabelsRemove.push("new-card");

  const conventionalMatch = title.trim().match(CONVENTIONAL_TITLE);
  const conventionalType = conventionalMatch?.[1]?.toLowerCase() ?? "";
  const isDocsMeta = !isCardPr && titleInfo.kind === "meta" && conventionalType === "docs";
  const isFeatureMeta =
    !isCardPr &&
    titleInfo.kind === "meta" &&
    conventionalType !== "" &&
    conventionalType !== "docs";

  if (isDocsMeta) classificationLabelsAdd.push("documentation");
  else classificationLabelsRemove.push("documentation");

  if (isFeatureMeta) classificationLabelsAdd.push("enhancement");
  else classificationLabelsRemove.push("enhancement");

  const completenessLabelsAdd: string[] = [];
  const completenessLabelsRemove: string[] = [];

  if (!titleInfo.ok) completenessLabelsAdd.push("title-needs-fix");
  else completenessLabelsRemove.push("title-needs-fix");

  const errorCount = issues.filter((i) => i.severity === "error").length;
  if (errorCount > 0) {
    completenessLabelsAdd.push("needs-info");
    completenessLabelsAdd.push("pr-form-incomplete");
  } else {
    completenessLabelsRemove.push("needs-info");
    completenessLabelsRemove.push("pr-form-incomplete");
  }

  if (issues.some((i) => i.code === "sources")) {
    completenessLabelsAdd.push("missing-sources");
  } else {
    completenessLabelsRemove.push("missing-sources");
  }

  if (duplicatePrs.length > 0) completenessLabelsAdd.push("duplicate");
  else completenessLabelsRemove.push("duplicate");

  const labelsAdd = [
    ...new Set([...classificationLabelsAdd, ...completenessLabelsAdd]),
  ];
  const labelsRemove = [
    ...new Set([
      ...classificationLabelsRemove,
      ...completenessLabelsRemove,
    ]),
  ].filter((l) => !labelsAdd.includes(l));

  const warnings = issues.filter((i) => i.severity === "warn");
  const errors = issues.filter((i) => i.severity === "error");

  const lines: string[] = [];
  lines.push("<!-- opencard-form-check -->");
  if (errors.length === 0 && titleInfo.ok) {
    lines.push("### PR Form check passed");
    lines.push("");
    lines.push("> [!TIP]");
    lines.push(
      "> Form looks complete enough for review. Thanks! Maintainers may still ask follow-ups.",
    );
    if (warnings.length > 0) {
      lines.push("");
      lines.push("**Friendly tips (not blocking):**");
      for (const w of warnings) lines.push(`- ${w.message}`);
    }
  } else {
    lines.push("### PR Form check failed");
    lines.push("");
    const author = (process.env.PR_AUTHOR ?? "").replace(/^@/, "").trim();
    if (author) {
      lines.push(`@${author} thanks for the pull request.`);
      lines.push("");
    }
    lines.push(
      "The **Form check** job failed so maintainers don’t have to repeat the same review notes. Please fix the items below **on this PR** (edit the title/body or push a commit) — do **not** open a new PR.",
    );
    lines.push("");
    lines.push("**What to fix:**");
    for (const e of errors) lines.push(`1. ${e.message}`);
    if (warnings.length > 0) {
      lines.push("");
      lines.push("**Also good to know:**");
      for (const w of warnings) lines.push(`- ${w.message}`);
    }
    lines.push("");
    lines.push(
      "After you fix things, this comment updates automatically. The **Labels** check only classifies the PR (`new-card` / `US` / …) and stays green even when the form needs work.",
    );
  }
  lines.push("");
  lines.push("<details><summary>Beginner cheat-sheet</summary>");
  lines.push("");
  lines.push(
    "- **Cards:** `card(add): us-my-card` or `card(update): us-my-card`",
  );
  lines.push(
    "- **Everything else:** `feat: …` / `fix(scope): …` / `docs: …` / `ci: …` / `chore: …` / …",
  );
  lines.push("- One card per PR; id = `{country}-{slug}` matching `data/{country}/{slug}.json`");
  lines.push("- Official Sources required; `last_verified` = the day you checked");
  lines.push(
    "- Updates must bump `last_verified` to a **newer** date than the version already on main",
  );
  lines.push(
    "- If another open PR already adds the same card, collaborate there instead of duplicating",
  );
  lines.push(
    "- Images: official URL, Apple Pay `@2x` extract → lossless WebP, or “No image yet”",
  );
  if (suggestedTitle) {
    lines.push(`- Suggested title: \`${suggestedTitle}\``);
  }
  lines.push("");
  lines.push("</details>");

  return {
    titleOk: titleInfo.ok,
    titleKind: titleInfo.kind,
    titleMessage: titleInfo.message,
    suggestedTitle,
    regions,
    isCardPr,
    isNewCard,
    cardIds,
    missing,
    issues,
    duplicatePrs,
    classificationLabelsAdd: [...new Set(classificationLabelsAdd)],
    classificationLabelsRemove: [...new Set(classificationLabelsRemove)].filter(
      (l) => !classificationLabelsAdd.includes(l),
    ),
    completenessLabelsAdd: [...new Set(completenessLabelsAdd)],
    completenessLabelsRemove: [...new Set(completenessLabelsRemove)].filter(
      (l) => !completenessLabelsAdd.includes(l),
    ),
    labelsAdd,
    labelsRemove,
    commentMarkdown: lines.join("\n"),
  };
}
