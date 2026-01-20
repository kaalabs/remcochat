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

test("defaults app.attachments when omitted", () => {
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

  assert.equal(config.attachments.enabled, true);
  assert.deepEqual(config.attachments.allowedMediaTypes, [
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/pdf",
  ]);
  assert.equal(config.attachments.maxFilesPerMessage, 3);
  assert.equal(config.attachments.maxFileSizeBytes, 2_000_000);
  assert.equal(config.attachments.maxTotalSizeBytes, 5_000_000);
  assert.equal(config.attachments.maxExtractedTextChars, 120_000);
  assert.equal(config.attachments.temporaryTtlMs, 6 * 60 * 60_000);
  assert.equal(config.attachments.sandbox.runtime, "node22");
  assert.equal(config.attachments.sandbox.vcpus, 2);
  assert.equal(config.attachments.sandbox.timeoutMs, 900_000);
  assert.equal(config.attachments.processing.timeoutMs, 30_000);
  assert.equal(config.attachments.processing.maxStdoutChars, 200_000);
  assert.equal(config.attachments.processing.maxStderrChars, 20_000);
});

test("parses app.attachments config overrides", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.attachments]
enabled = false
allowed_media_types = ["text/plain"]
max_files_per_message = 5
max_file_size_bytes = 1234
max_total_size_bytes = 5678
max_extracted_text_chars = 9000
temporary_ttl_ms = 60000

[app.attachments.sandbox]
runtime = "node22"
vcpus = 1
timeout_ms = 600000

[app.attachments.processing]
timeout_ms = 5000
max_stdout_chars = 1000
max_stderr_chars = 2000

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  const config = getConfig();

  assert.equal(config.attachments.enabled, false);
  assert.deepEqual(config.attachments.allowedMediaTypes, ["text/plain"]);
  assert.equal(config.attachments.maxFilesPerMessage, 5);
  assert.equal(config.attachments.maxFileSizeBytes, 1234);
  assert.equal(config.attachments.maxTotalSizeBytes, 5678);
  assert.equal(config.attachments.maxExtractedTextChars, 9000);
  assert.equal(config.attachments.temporaryTtlMs, 60_000);
  assert.equal(config.attachments.sandbox.runtime, "node22");
  assert.equal(config.attachments.sandbox.vcpus, 1);
  assert.equal(config.attachments.sandbox.timeoutMs, 600_000);
  assert.equal(config.attachments.processing.timeoutMs, 5000);
  assert.equal(config.attachments.processing.maxStdoutChars, 1000);
  assert.equal(config.attachments.processing.maxStderrChars, 2000);
});

