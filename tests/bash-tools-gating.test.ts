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
const ORIGINAL_FETCH = globalThis.fetch;

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

  globalThis.fetch = ORIGINAL_FETCH;

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

test("does not expose docker bash tools when sandboxd cannot reach docker socket", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.bash_tools]
enabled = true
provider = "docker"
access = "localhost"

[app.bash_tools.docker]
orchestrator_url = "http://127.0.0.1:8080"

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

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "http://127.0.0.1:8080/v1/health") {
      return new Response(
        JSON.stringify({ error: "connect ENOENT /var/run/docker.sock" }),
        {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof globalThis.fetch;

  const result = await createBashTools({
    request: new Request("http://localhost/api/chat", {
      headers: { host: "localhost" },
    }),
    sessionKey: "test:docker-sock-missing",
  });

  assert.equal(result.enabled, false);
  assert.deepEqual(result.tools, {});
});
