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
  [key: string]: unknown;
};

export type Env = {
  OPENCARD_KV: KVNamespace;
  MODE?: string;
  REQUIRE_CLIENT_ID?: string;
  RATE_LIMIT_ENABLED?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  RATE_LIMIT_PER_DAY?: string;
  CACHE_MAX_AGE?: string;
};

export type Meta = {
  schema_version: string;
  card_count: number;
  countries: string[];
  generated_at: string;
};
