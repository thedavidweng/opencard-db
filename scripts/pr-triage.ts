/**
 * PR contribution triage helpers (title, body fields, region labels).
 * Used by CI workflows; safe to run locally with sample inputs.
 */

export type TriageInput = {
  title: string;
  body: string;
  changedFiles: string[];
};

export type TriageResult = {
  titleOk: boolean;
  titleKind: "add-card" | "update-card" | "meta" | "invalid";
  titleMessage: string;
  suggestedTitle: string | null;
  regions: Array<"US" | "CA" | "CN">;
  isCardPr: boolean;
  isNewCard: boolean;
  missing: string[];
  /** Kind / region only — used by the Labels CI job (never fails the PR). */
  classificationLabelsAdd: string[];
  classificationLabelsRemove: string[];
  /** Form / title completeness — used by the Form check CI job. */
  completenessLabelsAdd: string[];
  completenessLabelsRemove: string[];
  /** Union of both (tests / legacy). */
  labelsAdd: string[];
  labelsRemove: string[];
  commentMarkdown: string;
};

/** Labels that classify what the PR is (not whether the form is complete). */
export const CLASSIFICATION_LABELS = [
  "US",
  "CA",
  "CN",
  "new-card",
  "enhancement",
  "documentation",
] as const;

/** Labels that signal missing title/form fields. */
export const COMPLETENESS_LABELS = [
  "needs-info",
  "pr-form-incomplete",
  "missing-sources",
  "title-needs-fix",
] as const;

const CARD_TITLE =
  /^(Add|Update) card:\s*([a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const META_TITLE = /^(docs|ci|chore|fix|test|refactor)(\(.+\))?:\s.+/i;

const PLACEHOLDER_RE =
  /example|your-card|your_|placeholder|todo|tbd|xxxx|https:\/\/www\.example/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read a `**Label:** value` form field from the PR body.
 * Values are same-line only — never spill into the next bullet
 * (empty `**Product page:**` must not capture the Terms line below).
 */
function field(body: string, label: string): string | null {
  const re = new RegExp(
    String.raw`\*\*${escapeRegExp(label)}:\*\*[ \t]*(?:` +
      // `value` or bare remainder of the same line (may be empty)
      String.raw`\`([^\`\n]*)\`|([^\n]*))`,
    "i",
  );
  const m = body.match(re);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? "").trim();
  // Strip trailing HTML comments on the same line
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
  const card = t.match(CARD_TITLE);
  if (card) {
    return {
      ok: true,
      kind: card[1] === "Add" ? "add-card" : "update-card",
      message: "Title matches card convention.",
      cardId: card[2],
    };
  }
  if (META_TITLE.test(t)) {
    return {
      ok: true,
      kind: "meta",
      message: "Title matches non-card convention.",
      cardId: null,
    };
  }
  return {
    ok: false,
    kind: "invalid",
    message:
      "Title must look like `Add card: us-my-card`, `Update card: us-my-card`, or `docs: …` / `ci: …`.",
    cardId: null,
  };
}

export function suggestTitle(
  changedFiles: string[],
  body: string,
): string | null {
  const fromField = field(body, "Card ID");
  if (fromField && !PLACEHOLDER_RE.test(fromField)) {
    const kind = checkboxChecked(body, "Update existing card")
      ? "Update"
      : "Add";
    return `${kind} card: ${fromField}`;
  }
  for (const f of changedFiles) {
    const m = f.match(/^data\/([a-z]{2})\/([a-z0-9-]+)\.json$/);
    if (m) {
      const kind = checkboxChecked(body, "Update existing card")
        ? "Update"
        : "Add";
      return `${kind} card: ${m[1]}-${m[2]}`;
    }
  }
  return null;
}

function isPlaceholder(value: string | null): boolean {
  if (value == null) return true;
  if (value === "") return true;
  if (value.toLowerCase() === "unknown") return false;
  return PLACEHOLDER_RE.test(value);
}

export function triagePullRequest(input: TriageInput): TriageResult {
  const { title, body, changedFiles } = input;
  const titleInfo = parseTitle(title);
  const suggestedTitle = suggestTitle(changedFiles, body);
  const regions = detectRegions(changedFiles);
  const dataCardFiles = changedFiles.filter((f) =>
    /^data\/[a-z]{2}\/[a-z0-9-]+\.json$/.test(f),
  );
  const isCardPr =
    dataCardFiles.length > 0 ||
    checkboxChecked(body, "New card") ||
    checkboxChecked(body, "Update existing card") ||
    titleInfo.kind === "add-card" ||
    titleInfo.kind === "update-card";
  const isNewCard =
    titleInfo.kind === "add-card" || checkboxChecked(body, "New card");

  const missing: string[] = [];
  if (!titleInfo.ok) {
    missing.push(
      `PR title format${suggestedTitle ? ` (suggested: \`${suggestedTitle}\`)` : ""}`,
    );
  }

  if (isCardPr) {
    const cardId = field(body, "Card ID");
    const product = field(body, "Product page");
    const terms = field(body, "Terms / benefits page");
    const verified = field(body, "Last verified (YYYY-MM-DD)");
    const imageUrl = field(body, "Image URL");
    const localPath = field(body, "Local path after upload");
    // Template options A–D (also accept legacy “B. Upload a local file”).
    const noImage = checkboxChecked(body, "No image yet");
    const optOfficial =
      checkboxChecked(body, "A. Official issuer image URL") ||
      checkboxChecked(body, "A. Official image URL");
    const optApplePay = checkboxChecked(body, "B. Apple Pay extract");
    const optOtherUpload =
      checkboxChecked(body, "C. Other local upload") ||
      checkboxChecked(body, "B. Upload a local file");

    if (isPlaceholder(cardId)) missing.push("Card ID");
    if (isPlaceholder(product) && isPlaceholder(terms)) {
      missing.push("at least one official source URL (Product page or Terms page)");
    }
    if (
      !verified ||
      isPlaceholder(verified) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(verified)
    ) {
      missing.push("Last verified (YYYY-MM-DD)");
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
      missing.push(
        "Card image (official URL, Apple Pay / local `images/` upload, or check “No image yet”)",
      );
    }

    if (dataCardFiles.length === 0 && isNewCard) {
      missing.push("JSON file under `data/{us|ca|cn}/`");
    }
  }

  const classificationLabelsAdd: string[] = [];
  const classificationLabelsRemove: string[] = [];

  for (const r of ["US", "CA", "CN"] as const) {
    if (regions.includes(r)) classificationLabelsAdd.push(r);
    else classificationLabelsRemove.push(r);
  }

  // Card vs feature separation:
  // - add-card → new-card (+ region from data/images paths)
  // - non-card meta → documentation | enhancement (never new-card)
  if (isNewCard) classificationLabelsAdd.push("new-card");
  else classificationLabelsRemove.push("new-card");

  const isDocsMeta =
    !isCardPr && titleInfo.kind === "meta" && /^docs(\(|:)/i.test(title.trim());
  const isFeatureMeta =
    !isCardPr &&
    titleInfo.kind === "meta" &&
    /^(ci|chore|fix|test|refactor)(\(|:)/i.test(title.trim());

  if (isDocsMeta) classificationLabelsAdd.push("documentation");
  else classificationLabelsRemove.push("documentation");

  if (isFeatureMeta) classificationLabelsAdd.push("enhancement");
  else classificationLabelsRemove.push("enhancement");

  const completenessLabelsAdd: string[] = [];
  const completenessLabelsRemove: string[] = [];

  if (!titleInfo.ok) completenessLabelsAdd.push("title-needs-fix");
  else completenessLabelsRemove.push("title-needs-fix");

  if (missing.length > 0) {
    completenessLabelsAdd.push("needs-info");
    completenessLabelsAdd.push("pr-form-incomplete");
  } else {
    completenessLabelsRemove.push("needs-info");
    completenessLabelsRemove.push("pr-form-incomplete");
  }

  if (missing.some((m) => m.toLowerCase().includes("source"))) {
    completenessLabelsAdd.push("missing-sources");
  } else {
    completenessLabelsRemove.push("missing-sources");
  }

  const labelsAdd = [
    ...new Set([...classificationLabelsAdd, ...completenessLabelsAdd]),
  ];
  const labelsRemove = [
    ...new Set([
      ...classificationLabelsRemove,
      ...completenessLabelsRemove,
    ]),
  ].filter((l) => !labelsAdd.includes(l));

  const lines: string[] = [];
  lines.push("<!-- opencard-form-check -->");
  if (missing.length === 0 && titleInfo.ok) {
    lines.push("### PR Form check passed");
    lines.push("");
    lines.push("> [!TIP]");
    lines.push(
      "> Form looks complete enough for review. Thanks! Maintainers may still ask follow-ups.",
    );
  } else {
    lines.push("### PR Form check failed");
    lines.push("");
    const author = (process.env.PR_AUTHOR ?? "").replace(/^@/, "").trim();
    if (author) {
      lines.push(`@${author} thanks for the pull request.`);
      lines.push("");
    }
    lines.push(
      "The **Form check** CI job failed because required fields look incomplete (same idea as Homebrew’s incomplete-PR helper: CI fails **and** we leave this comment so you can fix it in place).",
    );
    lines.push("");
    lines.push(
      "**Please edit this pull request** (title and/or description) — do **not** open a new PR.",
    );
    lines.push("");
    lines.push("**Missing / invalid:**");
    for (const m of missing) lines.push(`- ${m}`);
    lines.push("");
    lines.push(
      "After you fix the items, push a commit or edit the PR body. This comment updates automatically.",
    );
    lines.push("");
    lines.push(
      "> The separate **Labels** check only classifies the PR (`new-card` / `US` / `enhancement` / …) and stays green even when the form is incomplete.",
    );
  }
  lines.push("");
  lines.push("<details><summary>Title &amp; form cheat-sheet</summary>");
  lines.push("");
  lines.push("- Title: `Add card: us-my-card` or `Update card: us-my-card`");
  lines.push("- Or non-card: `docs: …` / `ci: …` / `chore: …`");
  lines.push(
    "- Copy [`templates/card.template.json`](../blob/main/templates/card.template.json) → `data/{country}/{slug}.json`",
  );
  lines.push(
    "- Images: official URL, or Apple Pay `cardBackgroundCombined@2x.png` under `images/` (CI → lossless WebP). Prefer Apple Pay extracts over unknown crops.",
  );
  lines.push(
    "- CI: **Labels** = what kind of PR; **Form check** = required fields filled (+ this comment when incomplete).",
  );
  if (suggestedTitle) {
    lines.push(`- Suggested title from your files/form: \`${suggestedTitle}\``);
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
    missing,
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
