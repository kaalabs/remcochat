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

test("parses app.bash_tools (git seed)", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.bash_tools]
enabled = true
access = "localhost"
max_stdout_chars = 9000
max_stderr_chars = 9100
timeout_ms = 25000
max_concurrent_sandboxes = 2
idle_ttl_ms = 600000

[app.bash_tools.sandbox]
runtime = "node22"
ports = [3000]
vcpus = 2
timeout_ms = 900000

[app.bash_tools.seed]
mode = "git"
git_url = "https://example.com/repo.git"
git_revision = ""
upload_include = "**/*"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.ok(config.bashTools);
  assert.equal(config.bashTools.enabled, true);
  assert.equal(config.bashTools.access, "localhost");
  assert.equal(config.bashTools.projectRoot, null);
  assert.equal(config.bashTools.maxStdoutChars, 9000);
  assert.equal(config.bashTools.maxStderrChars, 9100);
  assert.equal(config.bashTools.timeoutMs, 25000);
  assert.equal(config.bashTools.maxConcurrentSandboxes, 2);
  assert.equal(config.bashTools.idleTtlMs, 600000);
  assert.equal(config.bashTools.sandbox.runtime, "node22");
  assert.deepEqual(config.bashTools.sandbox.ports, [3000]);
  assert.equal(config.bashTools.sandbox.vcpus, 2);
  assert.equal(config.bashTools.sandbox.timeoutMs, 900000);
  assert.equal(config.bashTools.seed.mode, "git");
  assert.equal(config.bashTools.seed.gitUrl, "https://example.com/repo.git");
  assert.equal(config.bashTools.seed.gitRevision, null);
  assert.equal(config.bashTools.seed.uploadInclude, "**/*");
});

test("rejects non-absolute app.bash_tools.project_root", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.bash_tools]
enabled = true
access = "localhost"
project_root = "relative/path"

[app.bash_tools.seed]
mode = "upload"
upload_include = "**/*"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  assert.throws(() => getConfig(), /app\.bash_tools\.project_root.*absolute/i);
});

test("rejects git seed missing git_url", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.bash_tools]
enabled = true

[app.bash_tools.seed]
mode = "git"
git_url = ""

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  assert.throws(() => getConfig(), /seed\.git_url.*required/i);
});
