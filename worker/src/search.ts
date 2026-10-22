/**
 * Free-text card search shared by the Worker (`/v1/search`) and the Node
 * contract-test handler (`scripts/export-handler.ts`). The site's client-side
 * search in `site/main.js` follows the same rules and alias list.
 *
 * A query matches a card when every whitespace-separated token is the start of
 * a word in the card's searchable text. Tokens containing non-ASCII letters
 * (Chinese names have no spaces between words) match anywhere in the text.
 */

export type SearchableCard = {
  id: string;
  name: string;
  issuer: string;
  issuer_id: string;
  network: string;
  network_tier: string;
  localized_names?: Record<string, string>;
};

export const NETWORK_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  unionpay: "UnionPay",
  jcb: "JCB",
};

/** Common abbreviations, keyed by network and then by network_tier ("*" = any tier). */
export const SEARCH_ALIASES: Record<string, Record<string, string[]>> = {
  mastercard: {
    world_elite: ["wemc", "wem"],
    world: ["wmc"],
    world_legend: ["wlmc"],
  },
  visa: {
    infinite: ["vi"],
    infinite_privilege: ["vip"],
    signature: ["vs"],
  },
  amex: { "*": ["amex"] },
};

/** Applied for this tier on any network. */
export const TIER_ALIASES: Record<string, string[]> = {
  platinum: ["plat"],
};

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function cardAliases(card: SearchableCard): string[] {
  const byNetwork = SEARCH_ALIASES[card.network] ?? {};
  return [
    ...(byNetwork["*"] ?? []),
    ...(byNetwork[card.network_tier] ?? []),
    ...(TIER_ALIASES[card.network_tier] ?? []),
  ];
}

export function searchText(card: SearchableCard): string {
  const tier =
    card.network_tier && card.network_tier !== "none" ? card.network_tier : "";
  return normalizeSearchText(
    [
      card.name,
      card.issuer,
      card.issuer_id,
      card.id,
      ...Object.values(card.localized_names ?? {}),
      card.network,
      NETWORK_LABELS[card.network] ?? "",
      tier,
      ...cardAliases(card),
    ].join(" "),
  );
}

const NON_ASCII = /[^\x00-\x7f]/;

export function searchMatch(card: SearchableCard, q: string): boolean {
  const tokens = normalizeSearchText(q).split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  const text = ` ${searchText(card)}`;
  return tokens.every((t) =>
    NON_ASCII.test(t) ? text.includes(t) : text.includes(` ${t}`),
  );
}
