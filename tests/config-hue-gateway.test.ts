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

test("parses app.hue_gateway when enabled", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.hue_gateway]
enabled = true
access = "lan"
base_urls = ["http://localhost:8000/", "http://hue-gateway:8000"]
timeout_ms = 9000
auth_header_env = "HUE_AUTH_HEADER"
bearer_token_env = "HUE_TOKEN"
api_key_env = "HUE_API_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.ok(config.hueGateway);
  assert.equal(config.hueGateway.enabled, true);
  assert.equal(config.hueGateway.access, "lan");
  assert.deepEqual(config.hueGateway.baseUrls, ["http://localhost:8000", "http://hue-gateway:8000"]);
  assert.equal(config.hueGateway.timeoutMs, 9000);
  assert.equal(config.hueGateway.authHeaderEnv, "HUE_AUTH_HEADER");
  assert.equal(config.hueGateway.bearerTokenEnv, "HUE_TOKEN");
  assert.equal(config.hueGateway.apiKeyEnv, "HUE_API_KEY");
});

test("defaults app.hue_gateway.base_urls when omitted", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.hue_gateway]
enabled = true

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.ok(config.hueGateway);
  assert.equal(config.hueGateway.enabled, true);
  assert.deepEqual(config.hueGateway.baseUrls, [
    "http://hue-gateway:8000",
    "http://host.docker.internal:8000",
    "http://localhost:8000",
  ]);
});

test("rejects app.hue_gateway.base_urls with a path", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.hue_gateway]
enabled = true
base_urls = ["http://localhost:8000/api"]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  assert.throws(() => getConfig(), /app\.hue_gateway\.base_urls.*path/i);
});

test("rejects app.hue_gateway.access invalid enum value", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.hue_gateway]
enabled = true
access = "world"

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

test("rejects app.hue_gateway.*_env values that are empty after trim", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.hue_gateway]
enabled = true
auth_header_env = "   "
bearer_token_env = "HUE_TOKEN"
api_key_env = "HUE_API_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  assert.throws(() => getConfig(), /app\.hue_gateway\.\*_env.*non-empty/i);
});

