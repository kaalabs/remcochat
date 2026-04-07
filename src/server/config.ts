import fs from "node:fs";
import path from "node:path";
import { parseConfigToml as parseConfigTomlInternal } from "./config-parse";
import type { RemcoChatConfig } from "./config-types";

export { parseConfigToml } from "./config-parse";
export { MODEL_TYPES } from "./config-types";
export type { ModelType, RemcoChatConfig, RemcoChatProvider } from "./config-types";

let cachedConfig: RemcoChatConfig | null = null;

function configPath() {
  const fromEnv = process.env.REMCOCHAT_CONFIG_PATH;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return path.join(process.cwd(), "config.toml");
}

export function getConfigFilePath(): string {
  return configPath();
}

export function getConfig(): RemcoChatConfig {
  if (cachedConfig) return cachedConfig;

  const filePath = configPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(
      [
        `Missing RemcoChat config file: ${filePath}`,
        "",
        "Create it by copying `config.toml.example` to `config.toml`.",
        "Or set `REMCOCHAT_CONFIG_PATH` to point at your config file.",
      ].join("\n")
    );
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`RemcoChat config path is not a file: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  cachedConfig = parseConfigTomlInternal(content);
  return cachedConfig;
}

export function _resetConfigCacheForTests() {
  cachedConfig = null;
}

export function resetConfigCache() {
  cachedConfig = null;
}
