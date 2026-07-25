export type Card = {
  id: string;
  name: string;
  country: string;
  issuer: string;
  issuer_id: string;
  network: string;
  network_tier: string;
  status: string;
  localized_names?: Record<string, string>;
  /** Derived card-art grade (build-time; see docs/api.md#card-art-grade). */
  art_grade?: "apple-pay" | "issuer" | "none";
  [key: string]: unknown;
};

export type Meta = {
  schema_version: string;
  card_count: number;
  countries: string[];
  /** Card-art grade counts (build-time; see docs/api.md#card-art-grade). */
  art_grades?: Record<"apple-pay" | "issuer" | "none", number>;
  generated_at: string;
  /** Absolute URL to the generic card-face fallback (set at request time). */
  default_card_image?: string;
};
