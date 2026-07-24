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
  labelsAdd: string[];
  labelsRemove: string[];
  commentMarkdown: string;
};

const CARD_TITLE =
  /^(Add|Update) card:\s*([a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const META_TITLE = /^(docs|ci|chore|fix|test|refactor)(\(.+\))?:\s.+/i;

const PLACEHOLDER_RE =
  /example|your-card|your_|placeholder|todo|tbd|xxxx|https:\/\/www\.example/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function field(body: string, label: string): string | null {
  const re = new RegExp(
    String.raw`\*\*${escapeRegExp(label)}:\*\*\s*(?:` +
      // `value` or bare value until end of line
      String.raw`\`([^\`]+)\`|(.+))`,
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
    const noImage = checkboxChecked(body, "No image yet");
    const optA = checkboxChecked(body, "A. Official image URL");
    const optB = checkboxChecked(body, "B. Upload a local file");

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
    const hasImage =
      noImage ||
      (optA && imageUrl && !isPlaceholder(imageUrl)) ||
      (optB && (hasImageFile || (localPath && !isPlaceholder(localPath)))) ||
      (imageUrl && !isPlaceholder(imageUrl)) ||
      hasImageFile;
    if (!hasImage) {
      missing.push(
        "Card image (official URL, uploaded `images/` file, or check “No image yet”)",
      );
    }

    if (dataCardFiles.length === 0 && isNewCard) {
      missing.push("JSON file under `data/{us|ca|cn}/`");
    }
  }

  const labelsAdd: string[] = [];
  const labelsRemove: string[] = [];

  for (const r of ["US", "CA", "CN"] as const) {
    if (regions.includes(r)) labelsAdd.push(r);
    else labelsRemove.push(r);
  }

  if (isNewCard) labelsAdd.push("new-card");
  else labelsRemove.push("new-card");

  if (!titleInfo.ok) labelsAdd.push("title-needs-fix");
  else labelsRemove.push("title-needs-fix");

  if (missing.length > 0) {
    labelsAdd.push("needs-info");
    labelsAdd.push("pr-form-incomplete");
  } else {
    labelsRemove.push("needs-info");
    labelsRemove.push("pr-form-incomplete");
  }

  if (
    missing.some((m) => m.toLowerCase().includes("source"))
  ) {
    labelsAdd.push("missing-sources");
  } else {
    labelsRemove.push("missing-sources");
  }

  const lines: string[] = [];
  lines.push("<!-- opencard-triage -->");
  lines.push("### OpenCard PR helper");
  lines.push("");
  if (missing.length === 0 && titleInfo.ok) {
    lines.push("> [!TIP]");
    lines.push(
      "> Looks complete enough for review. Thanks! Maintainers may still ask follow-ups.",
    );
  } else {
    lines.push("> [!IMPORTANT]");
    lines.push(
      "> Please fix the items below, then push a new commit (or edit the PR title/body). This comment updates automatically.",
    );
    lines.push("");
    lines.push("**Missing / invalid:**");
    for (const m of missing) lines.push(`- ${m}`);
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
    "- Prefer an official image URL; uploads under `images/` are auto-converted to WebP by CI",
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
    labelsAdd: [...new Set(labelsAdd)],
    labelsRemove: [...new Set(labelsRemove)].filter(
      (l) => !labelsAdd.includes(l),
    ),
    commentMarkdown: lines.join("\n"),
  };
}
