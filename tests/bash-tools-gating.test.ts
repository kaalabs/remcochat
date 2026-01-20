import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createBashTools } from "../src/ai/bash-tools";
import { _resetConfigCacheForTests } from "../src/server/config";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_ENABLE = process.env.REMCOCHAT_ENABLE_BASH_TOOL;
const ORIGINAL_ADMIN_TOKEN = process.env.REMCOCHAT_ADMIN_TOKEN;

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

  if (ORIGINAL_ENABLE === undefined) {
    delete process.env.REMCOCHAT_ENABLE_BASH_TOOL;
  } else {
    process.env.REMCOCHAT_ENABLE_BASH_TOOL = ORIGINAL_ENABLE;
  }

  if (ORIGINAL_ADMIN_TOKEN === undefined) {
    delete process.env.REMCOCHAT_ADMIN_TOKEN;
  } else {
    process.env.REMCOCHAT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  }
});

test("does not expose bash tools when env kill-switch is off", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.bash_tools]
enabled = true
access = "localhost"

[app.bash_tools.seed]
mode = "git"
git_url = "https://example.com/repo.git"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.REMCOCHAT_ENABLE_BASH_TOOL = "0";

  const result = await createBashTools({
    request: new Request("http://localhost/api/chat", {
      headers: { host: "localhost" },
    }),
    sessionKey: "test:kill-switch-off",
  });

  assert.equal(result.enabled, false);
  assert.deepEqual(result.tools, {});
});

test("does not expose bash tools for lan access without admin token", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.bash_tools]
enabled = true
access = "lan"

[app.bash_tools.seed]
mode = "git"
git_url = "https://example.com/repo.git"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.REMCOCHAT_ENABLE_BASH_TOOL = "1";
  delete process.env.REMCOCHAT_ADMIN_TOKEN;

  const result = await createBashTools({
    request: new Request("http://localhost/api/chat", {
      headers: { host: "localhost" },
    }),
    sessionKey: "test:lan-no-token",
  });

  assert.equal(result.enabled, false);
  assert.deepEqual(result.tools, {});
});

test("does not expose bash tools for non-local requests when access=localhost", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.bash_tools]
enabled = true
access = "localhost"

[app.bash_tools.seed]
mode = "git"
git_url = "https://example.com/repo.git"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.REMCOCHAT_ENABLE_BASH_TOOL = "1";

  const result = await createBashTools({
    request: new Request("http://example.com/api/chat", {
      headers: { host: "example.com" },
    }),
    sessionKey: "test:non-local",
  });

  assert.equal(result.enabled, false);
  assert.deepEqual(result.tools, {});
});

