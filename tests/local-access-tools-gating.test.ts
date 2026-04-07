import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { createLocalAccessTools } from "../src/ai/local-access-tools";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
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
  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.REMCOCHAT_CONFIG_PATH;
  else process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;

  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.REMCOCHAT_ADMIN_TOKEN;
  else process.env.REMCOCHAT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

test("local access tools are disabled for non-admin LAN requests", () => {
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.local_access]
enabled = true
allowed_commands = ["obsidian"]
allowed_directories = ["."]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  delete process.env.REMCOCHAT_ADMIN_TOKEN;
  _resetConfigCacheForTests();

  const req = new Request("http://example.com/api/chat", {
    headers: { host: "example.com" },
  });
  const res = createLocalAccessTools({ request: req });
  assert.equal(res.enabled, false);
  assert.deepEqual(Object.keys(res.tools), []);
});

test("local access tools are enabled for localhost requests when allowlisted", () => {
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.local_access]
enabled = true
allowed_commands = ["obsidian"]
allowed_directories = ["."]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  _resetConfigCacheForTests();

  const req = new Request("http://localhost/api/chat", {
    headers: { host: "localhost" },
  });
  const res = createLocalAccessTools({ request: req });
  assert.equal(res.enabled, true);
  const keys = Object.keys(res.tools).sort();
  assert.deepEqual(keys, ["localExec", "localListDir", "localReadFile", "obsidian"].sort());
});

test("obsidian tool is not exposed unless obsidian is allowlisted", () => {
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.local_access]
enabled = true
allowed_commands = ["modelsdev"]
allowed_directories = ["."]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  _resetConfigCacheForTests();

  const req = new Request("http://localhost/api/chat", {
    headers: { host: "localhost" },
  });
  const res = createLocalAccessTools({ request: req });
  assert.equal(res.enabled, true);
  assert.ok(Object.prototype.hasOwnProperty.call(res.tools, "localExec"));
  assert.equal(Object.prototype.hasOwnProperty.call(res.tools, "obsidian"), false);
});

test("local execution tools do not require approval for localhost requests", () => {
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.local_access]
enabled = true
allowed_commands = ["obsidian"]
allowed_directories = ["."]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  _resetConfigCacheForTests();

  const req = new Request("http://localhost/api/chat", {
    headers: { host: "localhost" },
  });
  const res = createLocalAccessTools({ request: req });

  assert.equal(res.metadataByName.localExec?.needsApproval, undefined);
  assert.equal(res.metadataByName.obsidian?.needsApproval, undefined);
  assert.equal(res.metadataByName.localReadFile?.needsApproval, undefined);
  assert.equal(res.metadataByName.localExec?.executionOwner, "server");
  assert.equal(res.metadataByName.obsidian?.executionOwner, "server");
  assert.equal(res.metadataByName.localReadFile?.executionOwner, "server");
});

test("local execution tools do not require approval for admin-token LAN requests", () => {
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.local_access]
enabled = true
allowed_commands = ["obsidian"]
allowed_directories = ["."]

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_ADMIN_TOKEN = "test-lan-admin-token";
  _resetConfigCacheForTests();

  const req = new Request("http://example.com/api/chat", {
    headers: {
      host: "example.com",
      "x-remcochat-admin-token": "test-lan-admin-token",
    },
  });
  const res = createLocalAccessTools({ request: req });

  assert.equal(res.enabled, true);
  assert.equal(res.metadataByName.localExec?.needsApproval, undefined);
  assert.equal(res.metadataByName.obsidian?.needsApproval, undefined);
  assert.equal(res.metadataByName.localReadFile?.needsApproval, undefined);
});
