import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createSkillsTools } from "../src/ai/skills-tools";
import { createTools } from "../src/ai/tools";
import { createWebTools } from "../src/ai/web-tools";
import {
  listToolNamesByExecutionOwner,
  mergeToolBundles,
} from "../src/ai/tool-bundle";
import { _resetConfigCacheForTests } from "../src/server/config";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;

function writeTempConfigToml(content: string) {
  const filePath = path.join(
    os.tmpdir(),
    `remcochat-tool-ownership-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`,
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

test("current bundled tools default to server-owned execution", () => {
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "openai_compat"

[app.web_tools]
enabled = true
search_provider = "exa"
max_results = 3
allowed_domains = []
blocked_domains = []

[providers.openai_compat]
name = "OpenAI Compatible"
api_key_env = "OPENAI_COMPAT_API_KEY"
base_url = "https://example.com/v1"
default_model_id = "compat-model"
allowed_model_ids = ["compat-model"]
`);
  _resetConfigCacheForTests();

  const bundle = mergeToolBundles(
    createTools({
      profileId: "profile_test",
      viewerTimeZone: "Europe/Amsterdam",
      isTemporary: false,
    }),
    createSkillsTools({ enabled: true }),
    createWebTools({
      providerId: "openai_compat",
      modelType: "openai_compatible",
      providerModelId: "compat-model",
    }),
  );

  assert.equal(bundle.enabled, true);
  assert.deepEqual(listToolNamesByExecutionOwner(bundle, "client"), []);
  for (const entry of bundle.entries) {
    assert.equal(entry.metadata.executionOwner, "server");
  }
});
