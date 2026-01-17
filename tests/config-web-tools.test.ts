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

test("parses app.web_tools", () => {
  const configPath = writeTempConfigToml(`
version = 1

[app]
default_provider_id = "vercel"

[app.web_tools]
enabled = true
max_results = 7
recency = "week"
allowed_domains = ["vercel.com"]
blocked_domains = []

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"

[[providers.vercel.models]]
type = "vercel_ai_gateway"
id = "openai/gpt-4o-mini"
label = "GPT 4o Mini"
[providers.vercel.models.capabilities]
tools = true
temperature = true
attachments = false
structured_output = false
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();
  assert.ok(config.webTools);
  assert.equal(config.webTools.enabled, true);
  assert.equal(config.webTools.maxResults, 7);
  assert.equal(config.webTools.recency, "week");
  assert.deepEqual(config.webTools.allowedDomains, ["vercel.com"]);
  assert.deepEqual(config.webTools.blockedDomains, []);
});

test("rejects mixed allowed_domains and blocked_domains", () => {
  const configPath = writeTempConfigToml(`
version = 1

[app]
default_provider_id = "vercel"

[app.web_tools]
enabled = true
allowed_domains = ["vercel.com"]
blocked_domains = ["reddit.com"]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"

[[providers.vercel.models]]
type = "vercel_ai_gateway"
id = "openai/gpt-4o-mini"
label = "GPT 4o Mini"
[providers.vercel.models.capabilities]
tools = true
temperature = true
attachments = false
structured_output = false
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  assert.throws(() => getConfig(), /app\.web_tools\.allowed_domains.*blocked_domains/);
});

