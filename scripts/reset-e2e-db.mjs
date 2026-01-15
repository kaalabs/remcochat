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
    'default_model_id = "opencode/gpt-5-nano-alt"',
    "",
    "[[providers.e2e_alt.models]]",
    'type = "openai_responses"',
    'id = "opencode/gpt-5-nano-alt"',
    'label = "GPT 5 Nano (Alt)"',
    'description = "OpenCode Zen"',
    'provider_model_id = "gpt-5-nano"',
    "[providers.e2e_alt.models.capabilities]",
    "tools = true",
    "temperature = false",
    "attachments = false",
    "structured_output = false",
    "",
    "[[providers.e2e_alt.models]]",
    'type = "openai_responses"',
    'id = "opencode/gpt-5-nano-no-tools-alt"',
    'label = "GPT 5 Nano (No Tools Alt)"',
    'description = "OpenCode Zen"',
    'provider_model_id = "gpt-5-nano"',
    "[providers.e2e_alt.models.capabilities]",
    "tools = false",
    "temperature = false",
    "attachments = false",
    "structured_output = false",
    "",
    "[[providers.e2e_alt.models]]",
    'type = "anthropic_messages"',
    'id = "opencode/claude-opus-4-5-alt"',
    'label = "Claude Opus 4.5 (Alt)"',
    'description = "OpenCode Zen"',
    'provider_model_id = "claude-opus-4-5"',
    "[providers.e2e_alt.models.capabilities]",
    "tools = true",
    "temperature = true",
    "attachments = false",
    "structured_output = false",
    "",
    "[[providers.e2e_alt.models]]",
    'type = "openai_compatible"',
    'id = "opencode/glm-4.7-free-alt"',
    'label = "GLM-4.7 (Alt)"',
    'description = "OpenCode Zen"',
    'provider_model_id = "glm-4.7-free"',
    "[providers.e2e_alt.models.capabilities]",
    "tools = true",
    "temperature = true",
    "attachments = false",
    "structured_output = false",
    "",
    "[[providers.e2e_alt.models]]",
    'type = "google_generative_ai"',
    'id = "opencode/gemini-3-pro-alt"',
    'label = "Gemini 3 Pro (Alt)"',
    'description = "OpenCode Zen"',
    'provider_model_id = "gemini-3-pro"',
    "[providers.e2e_alt.models.capabilities]",
    "tools = true",
    "temperature = true",
    "attachments = false",
    "structured_output = false",
    "",
  ].join("\n");
  fs.writeFileSync(configPath, `${example.trimEnd()}\n\n${extra}`);
} catch (err) {
  console.error("Failed to prepare E2E config file:", err);
  process.exit(1);
}
