import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { createWebTools } from "../src/ai/web-tools";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_GATEWAY_API_KEY = process.env.VERCEL_AI_GATEWAY_API_KEY;

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
  if (ORIGINAL_GATEWAY_API_KEY === undefined) {
    delete process.env.VERCEL_AI_GATEWAY_API_KEY;
  } else {
    process.env.VERCEL_AI_GATEWAY_API_KEY = ORIGINAL_GATEWAY_API_KEY;
  }
});

test("AI Gateway OpenAI models use web_search", () => {
  process.env.VERCEL_AI_GATEWAY_API_KEY = "test";
  const configPath = writeTempConfigToml(`
version = 1

[app]
default_provider_id = "vercel"

[app.web_tools]
enabled = true

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-5.2-chat"

[[providers.vercel.models]]
type = "vercel_ai_gateway"
id = "openai/gpt-5.2-chat"
label = "GPT 5.2 Chat"
[providers.vercel.models.capabilities]
tools = true
temperature = false
attachments = false
structured_output = false
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const { enabled, tools } = createWebTools({
    providerId: "vercel",
    modelType: "vercel_ai_gateway",
    providerModelId: "openai/gpt-5.2-chat",
  });
  assert.equal(enabled, true);
  assert.ok("web_search" in tools);
  assert.ok(!("perplexity_search" in tools));
});

test("AI Gateway non-OpenAI models fall back to perplexity_search", () => {
  process.env.VERCEL_AI_GATEWAY_API_KEY = "test";
  const configPath = writeTempConfigToml(`
version = 1

[app]
default_provider_id = "vercel"

[app.web_tools]
enabled = true

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "anthropic/claude-sonnet-4.5"

[[providers.vercel.models]]
type = "vercel_ai_gateway"
id = "anthropic/claude-sonnet-4.5"
label = "Claude Sonnet"
[providers.vercel.models.capabilities]
tools = true
temperature = true
attachments = false
structured_output = false
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const { enabled, tools } = createWebTools({
    providerId: "vercel",
    modelType: "vercel_ai_gateway",
    providerModelId: "anthropic/claude-sonnet-4.5",
  });
  assert.equal(enabled, true);
  assert.ok("perplexity_search" in tools);
  assert.ok("web_fetch" in tools);
});
