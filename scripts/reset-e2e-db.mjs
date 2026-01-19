import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.REMCOCHAT_DB_PATH
  ? path.resolve(process.env.REMCOCHAT_DB_PATH)
  : path.join(process.cwd(), "data", "remcochat-e2e.sqlite");

const configPath = process.env.REMCOCHAT_CONFIG_PATH
  ? path.resolve(process.env.REMCOCHAT_CONFIG_PATH)
  : path.join(process.cwd(), "data", "remcochat-e2e-config.toml");

const exampleConfigPath = path.join(process.cwd(), "config.toml.example");

try {
  fs.rmSync(dbPath, { force: true });
} catch {
  // ignore
}

try {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const example = fs.readFileSync(exampleConfigPath, "utf8");
  const extra = [
    "",
    "[providers.e2e_alt]",
    'name = "E2E Alt Provider"',
    'base_url = "https://opencode.ai/zen/v1"',
    'api_key_env = "OPENCODE_API_KEY"',
    'modelsdev_provider_id = "opencode"',
    'default_model_id = "gpt-5-nano"',
    "allowed_model_ids = [",
    '  "gpt-5-nano",',
    '  "claude-opus-4-5",',
    '  "glm-4.7-free",',
    '  "gemini-3-pro",',
    "]",
    "",
    "[providers.e2e_vercel]",
    'name = "E2E Vercel Catalog"',
    'base_url = "https://ai-gateway.vercel.sh/v3/ai"',
    'api_key_env = "VERCEL_AI_GATEWAY_API_KEY"',
    'modelsdev_provider_id = "vercel"',
    'default_model_id = "anthropic/claude-opus-4.5"',
    "allowed_model_ids = [",
    '  "anthropic/claude-opus-4.5",',
    '  "openai/gpt-3.5-turbo",',
    "]",
    "",
  ].join("\n");
  fs.writeFileSync(configPath, `${example.trimEnd()}\n\n${extra}`);
} catch (err) {
  console.error("Failed to prepare E2E config file:", err);
  process.exit(1);
}
