import TOML from "@iarna/toml";
import { RawConfigSchema } from "./config-schema";
import type { RemcoChatConfig } from "./config-types";
import { normalizeConfig } from "./config-normalize";

function tomlToPlainObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => tomlToPlainObject(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      output[key] = tomlToPlainObject(inner);
    }
    return output;
  }

  return value;
}

export function parseConfigToml(content: string): RemcoChatConfig {
  const parsed = TOML.parse(content);
  const raw = RawConfigSchema.parse(tomlToPlainObject(parsed));
  return normalizeConfig(raw);
}
