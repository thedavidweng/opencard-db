import { bindings, defineConfig } from "cf/config";

export default defineConfig(({ mode }) => ({
	...(mode === "production" ? { accountId: "99e63a7c867f83d0d7806e0e6cd09933" } : {}),
	worker: {
		name: "opencard-db",
		compatibilityDate: "2026-07-24",
		entrypoint: "src/index.ts",
		...(mode === "production" ? { workersDev: true } : {}),
		observability: { enabled: true },
		env: {
			MODE: bindings.text(mode === "production" ? "official" : "selfhost"),
			REQUIRE_CLIENT_ID: bindings.text(mode === "production" ? "true" : "false"),
			RATE_LIMIT_ENABLED: bindings.text(mode === "production" ? "true" : "false"),
			RATE_LIMIT_PER_MINUTE: bindings.text("30"),
			RATE_LIMIT_PER_DAY: bindings.text("500"),
			CACHE_MAX_AGE: bindings.text("300"),
			OPENCARD_KV: bindings.kv({
				id: mode === "production" ? "6d0b887ca4e84d91bda6d4b0cd516b5e" : "00000000000000000000000000000000",
			}),
		},
	},
}));
