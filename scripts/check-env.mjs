import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import TOML from "@iarna/toml";
import Database from "better-sqlite3";

const configPath = process.env.REMCOCHAT_CONFIG_PATH?.trim()
  ? path.resolve(process.env.REMCOCHAT_CONFIG_PATH.trim())
  : path.join(process.cwd(), "config.toml");

if (!fs.existsSync(configPath)) {
  console.error(
    [
      `Missing RemcoChat config file: ${configPath}`,
      "",
      "Create it by copying:",
      "  cp config.toml.example config.toml",
      "",
      "Or set:",
      "  export REMCOCHAT_CONFIG_PATH='/path/to/config.toml'",
    ].join("\n")
  );
  process.exit(1);
}

try {
  const stat = fs.statSync(configPath);
  if (!stat.isFile()) {
    throw new Error("not a file");
  }
} catch {
  console.error(`RemcoChat config path is not a file: ${configPath}`);
  process.exit(1);
}

try {
  execFileSync("modelsdev", ["--version"], { stdio: "ignore" });
} catch {
  console.error(
    [
      "Missing required CLI dependency: modelsdev",
      "",
      "Install modelsdev and ensure it's available on PATH:",
      "  https://models.dev",
    ].join("\n")
  );
  process.exit(1);
}

function tomlToPlainObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => tomlToPlainObject(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = tomlToPlainObject(inner);
    }
    return out;
  }
  return value;
}

function getDbPath() {
  if (process.env.REMCOCHAT_DB_PATH) {
    return path.resolve(process.env.REMCOCHAT_DB_PATH);
  }
  return path.join(process.cwd(), "data", "remcochat.sqlite");
}

function getActiveProviderIdFromDb() {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) return null;

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }

  try {
    const hasSettings = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'`
      )
      .get();
    if (!hasSettings) return null;

    const row = db
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get("active_provider_id");
    return typeof row?.value === "string" ? row.value : null;
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

let parsedConfig;
try {
  const raw = TOML.parse(fs.readFileSync(configPath, "utf8"));
  parsedConfig = tomlToPlainObject(raw);
} catch (err) {
  console.error(
    `Failed to parse RemcoChat config.toml at ${configPath}: ${
      err instanceof Error ? err.message : String(err)
    }`
  );
  process.exit(1);
}

if (parsedConfig?.version !== 2) {
  console.error(
    [
      `Unsupported RemcoChat config version: ${String(parsedConfig?.version)}`,
      "",
      "This repo expects config.toml schema version = 2.",
      "",
      "To migrate quickly:",
      "  cp config.toml.example config.toml",
      "",
      "Or update your existing file by removing [[providers.<id>.models]] blocks and adding:",
      "  providers.<id>.allowed_model_ids = [...]",
      "  providers.<id>.default_model_id = \"...\"",
    ].join("\n")
  );
  process.exit(1);
}

const defaultProviderId =
  typeof parsedConfig?.app?.default_provider_id === "string" &&
  parsedConfig.app.default_provider_id.trim()
    ? parsedConfig.app.default_provider_id.trim()
    : "";

const routerConfig =
  parsedConfig?.app?.router && typeof parsedConfig.app.router === "object"
    ? parsedConfig.app.router
    : null;

const providers =
  parsedConfig?.providers && typeof parsedConfig.providers === "object"
    ? parsedConfig.providers
    : null;

if (!defaultProviderId || !providers || !providers[defaultProviderId]) {
  console.error(
    [
      "Invalid config.toml: missing or invalid app.default_provider_id / providers.",
      "Start from config.toml.example.",
    ].join("\n")
  );
  process.exit(1);
}

const storedActiveProviderId = getActiveProviderIdFromDb();
const activeProviderId =
  storedActiveProviderId && providers[storedActiveProviderId]
    ? storedActiveProviderId
    : defaultProviderId;

const routerEnabled = routerConfig?.enabled === true;
const routerProviderId =
  routerEnabled && typeof routerConfig?.provider_id === "string"
    ? routerConfig.provider_id.trim()
    : "";
const routerModelId =
  routerEnabled && typeof routerConfig?.model_id === "string"
    ? routerConfig.model_id.trim()
    : "";

if (routerEnabled) {
  if (!routerProviderId) {
    console.error(
      "Invalid config.toml: app.router.provider_id is required when router is enabled"
    );
    process.exit(1);
  }
  if (!routerModelId) {
    console.error(
      "Invalid config.toml: app.router.model_id is required when router is enabled"
    );
    process.exit(1);
  }
  if (!providers?.[routerProviderId]) {
    console.error(
      `Invalid config.toml: app.router.provider_id "${routerProviderId}" is not present in providers`
    );
    process.exit(1);
  }
}

for (const [providerId, provider] of Object.entries(providers)) {
  const apiKeyEnv = provider?.api_key_env;
  const baseUrl = provider?.base_url;
  const defaultModelId = provider?.default_model_id;
  const allowedModelIds = provider?.allowed_model_ids;

  if (typeof provider?.name !== "string" || !provider.name.trim()) {
    console.error(`Invalid config.toml: providers.${providerId}.name is required`);
    process.exit(1);
  }

  if (typeof apiKeyEnv !== "string" || !apiKeyEnv.trim()) {
    console.error(
      `Invalid config.toml: providers.${providerId}.api_key_env is required`
    );
    process.exit(1);
  }

  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    console.error(
      `Invalid config.toml: providers.${providerId}.base_url is required`
    );
    process.exit(1);
  }

  if (typeof defaultModelId !== "string" || !defaultModelId.trim()) {
    console.error(
      `Invalid config.toml: providers.${providerId}.default_model_id is required`
    );
    process.exit(1);
  }

  if (!Array.isArray(allowedModelIds) || allowedModelIds.length === 0) {
    console.error(
      `Invalid config.toml: providers.${providerId}.allowed_model_ids must be a non-empty array`
    );
    process.exit(1);
  }
  if (!allowedModelIds.some((id) => typeof id === "string" && id === defaultModelId)) {
    console.error(
      `Invalid config.toml: providers.${providerId}.default_model_id "${defaultModelId}" is not present in providers.${providerId}.allowed_model_ids`
    );
    process.exit(1);
  }

  if (routerEnabled && providerId === routerProviderId) {
    if (!allowedModelIds.some((id) => typeof id === "string" && id === routerModelId)) {
      console.error(
        `Invalid config.toml: app.router.model_id "${routerModelId}" is not present in providers.${providerId}.allowed_model_ids`
      );
      process.exit(1);
    }
  }

  if (providerId === activeProviderId) {
    const key = process.env[apiKeyEnv];
    if (!key) {
      console.error(
        [
          `Missing API key for provider "${providerId}".`,
          "",
          `Export it in your shell before running RemcoChat:`,
          `  export ${apiKeyEnv}='...'`,
        ].join("\n")
      );
      process.exit(1);
    }
  }

  if (routerEnabled && providerId === routerProviderId) {
    const key = process.env[apiKeyEnv];
    if (!key) {
      console.error(
        [
          `Missing API key for router provider "${providerId}".`,
          "",
          `Export it in your shell before running RemcoChat:`,
          `  export ${apiKeyEnv}='...'`,
        ].join("\n")
      );
      process.exit(1);
    }
  }
}
