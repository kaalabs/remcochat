import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import TOML from "@iarna/toml";
import Database from "better-sqlite3";

function parseDotenvValue(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    const inner = trimmed.slice(1, -1);
    if (first === "'") return inner;
    return inner
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }

  // Strip trailing inline comments: KEY=value # comment
  let out = "";
  let sawWhitespace = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "#") {
      if (sawWhitespace) break;
    }
    if (ch === " " || ch === "\t") {
      sawWhitespace = true;
      out += ch;
    } else {
      sawWhitespace = false;
      out += ch;
    }
  }
  return out.trim();
}

function loadDotenvFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;

    const idx = normalized.indexOf("=");
    if (idx <= 0) continue;

    const key = normalized.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    const rawValue = normalized.slice(idx + 1);
    process.env[key] = parseDotenvValue(rawValue);
  }
}

function loadDotenvFromCwd() {
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim() || "development";
  const cwd = process.cwd();
  const candidates = [
    `.env.${nodeEnv}.local`,
    ".env.local",
    `.env.${nodeEnv}`,
    ".env",
  ];
  for (const name of candidates) {
    const filePath = path.join(cwd, name);
    if (!fs.existsSync(filePath)) continue;
    loadDotenvFile(filePath);
  }
}

// Ensure `npm run dev` / `npm run start` works with `vercel env pull` (writes `.env.local`)
// even though this script runs before Next.js loads env files.
loadDotenvFromCwd();

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

function isTruthyEnv(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
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

const bashTools = parsedConfig?.app?.bash_tools;
const bashToolsEnabled = bashTools?.enabled === true;
const ovNl = parsedConfig?.app?.ov_nl;
const ovNlEnabled = ovNl?.enabled === true;

function isProbablyWeakAdminToken(token) {
  const t = String(token ?? "").trim();
  // Heuristic: require at least 32 characters. Recommend: `openssl rand -hex 32`.
  return t.length > 0 && t.length < 32;
}

function isLocalhostHostname(hostname) {
  const h = String(hostname ?? "").trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

if (bashToolsEnabled) {
  if (!isTruthyEnv(process.env.REMCOCHAT_ENABLE_BASH_TOOL)) {
    console.error(
      [
        "Bash tools are enabled in config.toml (app.bash_tools.enabled=true), but the runtime kill-switch is not set.",
        "",
        "Set one of the following in your shell:",
        "  export REMCOCHAT_ENABLE_BASH_TOOL=1",
        "",
        "Or disable bash tools in config.toml.",
      ].join("\n")
    );
    process.exit(1);
  }

  const access =
    typeof bashTools?.access === "string" && bashTools.access.trim()
      ? bashTools.access.trim()
      : "localhost";

  if (access === "lan") {
    if (!String(process.env.REMCOCHAT_ADMIN_TOKEN ?? "").trim()) {
      console.error(
        [
          "Bash tools are configured for LAN access (app.bash_tools.access=\"lan\"), but REMCOCHAT_ADMIN_TOKEN is missing.",
          "",
          "Set:",
          "  export REMCOCHAT_ADMIN_TOKEN='...'",
        ].join("\n")
      );
      process.exit(1);
    }
    if (isProbablyWeakAdminToken(process.env.REMCOCHAT_ADMIN_TOKEN)) {
      console.error(
        [
          "REMCOCHAT_ADMIN_TOKEN looks too short for a no-auth LAN app.",
          "",
          "Recommended:",
          "  export REMCOCHAT_ADMIN_TOKEN=\"$(openssl rand -hex 32)\"",
        ].join("\n")
      );
      process.exit(1);
    }
  }

  const provider =
    typeof bashTools?.provider === "string" && bashTools.provider.trim()
      ? bashTools.provider.trim()
      : "vercel";

  if (provider === "docker") {
    const orchestratorUrl =
      typeof bashTools?.docker?.orchestrator_url === "string"
        ? bashTools.docker.orchestrator_url.trim()
        : "";

    if (!orchestratorUrl) {
      console.error(
        [
          "Bash tools are configured for the Docker sandbox orchestrator (app.bash_tools.provider=\"docker\"), but app.bash_tools.docker.orchestrator_url is missing.",
          "",
          "Set in config.toml:",
          "  [app.bash_tools.docker]",
          "  orchestrator_url = \"http://127.0.0.1:8080\"",
        ].join("\n")
      );
      process.exit(1);
    }

    // sandboxd auth is controlled by an env var (defaults to REMCOCHAT_ADMIN_TOKEN).
    // In dev, sandboxd often runs on localhost and does not require a token; do not
    // force a token in that case. If you point orchestrator_url at a non-local host,
    // require a strong token since the blast radius is much larger.
    let orchHost = "";
    try {
      orchHost = new URL(orchestratorUrl).hostname;
    } catch {
      // ignore; URL validity is validated elsewhere in the app, but this preflight is best-effort.
      orchHost = "";
    }

    const requiresSandboxdToken = Boolean(orchHost && !isLocalhostHostname(orchHost));
    if (requiresSandboxdToken) {
      const adminTokenEnv =
        typeof bashTools?.docker?.admin_token_env === "string" &&
        bashTools.docker.admin_token_env.trim()
          ? bashTools.docker.admin_token_env.trim()
          : "REMCOCHAT_ADMIN_TOKEN";

      const token = String(process.env[adminTokenEnv] ?? "").trim();
      if (!token) {
        console.error(
          [
            `Bash tools use a non-local Docker sandbox orchestrator (${orchestratorUrl}), but ${adminTokenEnv} is missing (required for sandboxd auth).`,
            "",
            "Set:",
            `  export ${adminTokenEnv}='...'`,
          ].join("\n")
        );
        process.exit(1);
      }
      if (isProbablyWeakAdminToken(token)) {
        console.error(
          [
            `${adminTokenEnv} looks too short for a token that gates sandboxd.`,
            "",
            "Recommended:",
            `  export ${adminTokenEnv}=\"$(openssl rand -hex 32)\"`,
          ].join("\n")
        );
        process.exit(1);
      }
    }
  } else if (provider === "vercel") {
  const hasOidc = Boolean(String(process.env.VERCEL_OIDC_TOKEN ?? "").trim());
  const teamOrOrgId = String(
    process.env.VERCEL_TEAM_ID ?? process.env.VERCEL_ORG_ID ?? ""
  ).trim();
  const hasAccessToken = Boolean(
    String(process.env.VERCEL_TOKEN ?? "").trim() &&
      teamOrOrgId &&
      String(process.env.VERCEL_PROJECT_ID ?? "").trim()
  );

  if (!hasOidc && !hasAccessToken) {
    console.error(
      [
        "Bash tools require Vercel Sandbox credentials, but none were found.",
        "",
        "Preferred (local dev):",
        "  export VERCEL_OIDC_TOKEN='...'",
        "",
        "Alternative:",
        "  export VERCEL_TOKEN='...'",
        "  export VERCEL_ORG_ID='...'  # (aka VERCEL_TEAM_ID)",
        "  export VERCEL_PROJECT_ID='...'",
        "",
        "See: https://vercel.com/docs/vercel-sandbox",
      ].join("\n")
    );
      process.exit(1);
    }
  } else {
    console.error(
      `Invalid config.toml: app.bash_tools.provider must be \"vercel\" or \"docker\"`
    );
    process.exit(1);
  }

  const seed = bashTools?.seed && typeof bashTools.seed === "object" ? bashTools.seed : {};
  const seedMode =
    typeof seed?.mode === "string" && seed.mode.trim() ? seed.mode.trim() : "git";

  if (seedMode === "git") {
    const gitUrl = typeof seed?.git_url === "string" ? seed.git_url.trim() : "";
    if (!gitUrl) {
      console.error(
        "Invalid config.toml: app.bash_tools.seed.git_url is required when seed.mode = \"git\""
      );
      process.exit(1);
    }
  } else if (seedMode === "upload") {
    const projectRoot =
      typeof bashTools?.project_root === "string" ? bashTools.project_root.trim() : "";
    if (!projectRoot) {
      console.error(
        "Invalid config.toml: app.bash_tools.project_root is required when seed.mode = \"upload\""
      );
      process.exit(1);
    }
    if (!path.isAbsolute(projectRoot)) {
      console.error(
        "Invalid config.toml: app.bash_tools.project_root must be an absolute path"
      );
      process.exit(1);
    }
  }
}

if (ovNlEnabled) {
  const subscriptionKeyEnv =
    typeof ovNl?.subscription_key_env === "string" && ovNl.subscription_key_env.trim()
      ? ovNl.subscription_key_env.trim()
      : "NS_APP_SUBSCRIPTION_KEY";
  const subscriptionKey = String(process.env[subscriptionKeyEnv] ?? "").trim();
  if (!subscriptionKey) {
    console.error(
      [
        `OV NL tool is enabled in config.toml (app.ov_nl.enabled=true), but ${subscriptionKeyEnv} is missing.`,
        "",
        "Set in your shell before starting RemcoChat:",
        `  export ${subscriptionKeyEnv}='...'`,
      ].join("\n")
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
