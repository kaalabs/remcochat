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

test("parses app.ov_nl when enabled", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "lan"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api/", "https://gateway.apiportal.ns.nl/reisinformatie-api"]
timeout_ms = 9000
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"
cache_max_ttl_seconds = 45

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.ok(config.ovNl);
  assert.equal(config.ovNl.enabled, true);
  assert.equal(config.ovNl.access, "lan");
  assert.deepEqual(config.ovNl.baseUrls, ["https://gateway.apiportal.ns.nl/reisinformatie-api"]);
  assert.equal(config.ovNl.timeoutMs, 9000);
  assert.equal(config.ovNl.subscriptionKeyEnv, "NS_APP_SUBSCRIPTION_KEY");
  assert.equal(config.ovNl.cacheMaxTtlSeconds, 45);
});

test("defaults app.ov_nl.base_urls when omitted", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
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

  assert.ok(config.ovNl);
  assert.equal(config.ovNl.enabled, true);
  assert.deepEqual(config.ovNl.baseUrls, [
    "https://gateway.apiportal.ns.nl/reisinformatie-api",
  ]);
});

test("accepts app.ov_nl.base_urls with a path", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
base_urls = ["https://example.com/reisinformatie-api"]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.ok(config.ovNl);
  assert.deepEqual(config.ovNl.baseUrls, ["https://example.com/reisinformatie-api"]);
});

test("rejects app.ov_nl.base_urls with query/hash", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
base_urls = ["https://example.com/reisinformatie-api?bad=1"]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  assert.throws(() => getConfig(), /app\.ov_nl\.base_urls.*query\/hash/i);
});

test("rejects app.ov_nl.subscription_key_env that is empty after trim", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
subscription_key_env = "   "

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  assert.throws(
    () => getConfig(),
    /app\.ov_nl\.subscription_key_env.*non-empty environment variable name/i
  );
});
