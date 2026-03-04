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

test("defaults app.local_access to null when omitted", () => {
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
  assert.equal(config.localAccess, null);
});

test("parses app.local_access allowlists when enabled", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.local_access]
enabled = true
allowed_commands = ["modelsdev", "modelsdev"]
allowed_directories = ["./data/", "~/my-allowed-dir"]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.ok(config.localAccess);
  assert.equal(config.localAccess.enabled, true);
  assert.deepEqual(config.localAccess.allowedCommands, ["modelsdev"]);
  assert.deepEqual(config.localAccess.allowedDirectories, [
    path.resolve(process.cwd(), "data"),
    path.join(os.homedir(), "my-allowed-dir"),
  ]);
});

