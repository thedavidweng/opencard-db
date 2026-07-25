export type CardImage = {
  url: string | null;
  attribution?: string | null;
  local_path?: string | null;
};

export type CardWithImage = {
  id?: string;
  image?: CardImage | null;
  [key: string]: unknown;
};

export const DEFAULT_CARD_IMAGE_PATH = "/v1/assets/default-card.webp";
export const DEFAULT_CARD_LOCAL_PATH = "images/default-card.webp";
export const DEFAULT_CARD_ATTRIBUTION =
  "OpenCard DB generic placeholder (not bank artwork)";

export function defaultCardImageUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${DEFAULT_CARD_IMAGE_PATH}`;
}

function hasUsableImageUrl(image: CardImage | null | undefined): boolean {
  return typeof image?.url === "string" && image.url.trim().length > 0;
}

/** Enrich a card so API consumers always receive a usable image.url. */
export function withDefaultCardImage<T extends CardWithImage>(
  card: T,
  origin: string,
): T {
  if (hasUsableImageUrl(card.image ?? null)) {
    return card;
  }

  const existing = card.image && typeof card.image === "object" ? card.image : {};
  const attribution =
    typeof existing.attribution === "string" && existing.attribution.trim()
      ? existing.attribution
      : DEFAULT_CARD_ATTRIBUTION;

  return {
    ...card,
    image: {
      ...existing,
      url: defaultCardImageUrl(origin),
      attribution,
      local_path:
        typeof existing.local_path === "string" && existing.local_path.trim()
          ? existing.local_path
          : DEFAULT_CARD_LOCAL_PATH,
    },
  };
}

export function withDefaultCardImages<T extends CardWithImage>(
  cards: T[],
  origin: string,
): T[] {
  return cards.map((c) => withDefaultCardImage(c, origin));
}
