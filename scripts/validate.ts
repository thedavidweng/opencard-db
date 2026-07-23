#!/usr/bin/env node
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  expectedIdFromPath,
  loadAllCards,
  loadSchema,
  type Card,
} from "./lib.ts";

function fail(messages: string[]): never {
  for (const m of messages) console.error(`error: ${m}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const schema = await loadSchema();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const loaded = await loadAllCards();
  if (loaded.length === 0) {
    console.warn("warning: no card JSON files under data/");
  }

  const errors: string[] = [];
  const seen = new Map<string, string>();

  for (const { file, card } of loaded) {
    const ok = validate(card);
    if (!ok) {
      const details = (validate.errors ?? [])
        .map((e) => `${e.instancePath || "/"} ${e.message}`)
        .join("; ");
      errors.push(`${file}: schema invalid — ${details}`);
    }

    const expected = expectedIdFromPath(file);
    if (card.id !== expected.id) {
      errors.push(
        `${file}: id "${card.id}" does not match path-derived id "${expected.id}"`,
      );
    }
    if (card.country !== expected.country) {
      errors.push(
        `${file}: country "${card.country}" does not match directory "${expected.country}"`,
      );
    }

    const prev = seen.get(card.id);
    if (prev) {
      errors.push(`${file}: duplicate id "${card.id}" (also in ${prev})`);
    } else {
      seen.set(card.id, file);
    }
  }

  if (errors.length) fail(errors);
  console.log(`ok: ${loaded.length} card(s) validated`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

export type { Card };
