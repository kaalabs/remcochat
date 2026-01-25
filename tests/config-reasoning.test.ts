import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests, getConfig } from "../src/server/config";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;

function writeTempConfigToml(content: string) {
  const filePath = path.join(
    os.tmpdir(),
    `remcochat-config-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`
  );
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

afterEach(() => {
  _resetConfigCacheForTests();
  if (ORIGINAL_CONFIG_PATH === undefined) {
    delete process.env.REMCOCHAT_CONFIG_PATH;
  } else {
    process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
  }
});

test("defaults app.reasoning when omitted", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.equal(config.reasoning.enabled, true);
  assert.equal(config.reasoning.effort, "medium");
  assert.equal(config.reasoning.exposeToClient, false);
  assert.equal(config.reasoning.openaiSummary, null);
  assert.equal(config.reasoning.anthropicBudgetTokens, null);
  assert.equal(config.reasoning.googleThinkingBudget, null);
});

test("parses app.reasoning overrides", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.reasoning]
enabled = false
effort = "high"
expose_to_client = true
openai_summary = "auto"
anthropic_budget_tokens = 1200
google_thinking_budget = 900

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.equal(config.reasoning.enabled, false);
  assert.equal(config.reasoning.effort, "high");
  assert.equal(config.reasoning.exposeToClient, true);
  assert.equal(config.reasoning.openaiSummary, "auto");
  assert.equal(config.reasoning.anthropicBudgetTokens, 1200);
  assert.equal(config.reasoning.googleThinkingBudget, 900);
});

test("rejects invalid app.reasoning.effort", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.reasoning]
effort = "extreme"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  assert.throws(() => getConfig());
});
