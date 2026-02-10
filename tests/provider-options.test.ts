import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "node:test";
import { test } from "node:test";
import {
  createProviderOptions,
  createProviderOptionsForWebTools,
} from "../src/ai/provider-options";
import { _resetConfigCacheForTests } from "../src/server/config";

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

test("web tools alone do not set providerOptions", () => {
  const options = createProviderOptions({
    modelType: "vercel_ai_gateway",
    providerModelId: "openai/gpt-5.2-pro",
    webToolsEnabled: true,
    capabilities: {
      tools: true,
      reasoning: false,
      temperature: true,
      attachments: false,
      structuredOutput: false,
    },
    reasoning: {
      enabled: true,
      effort: "medium",
      exposeToClient: false,
      openaiSummary: null,
      anthropicBudgetTokens: null,
      googleThinkingBudget: null,
    },
  });

  assert.equal(options, undefined);
});

test("xai web tools enable providerOptions.xai.searchParameters", () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "xai"

[app.web_tools]
enabled = true
search_provider = "exa"
allowed_domains = ["arxiv.org", "openai.com"]
blocked_domains = []

[providers.xai]
name = "xAI"
api_key_env = "XAI_API_KEY"
base_url = "https://api.x.ai/v1"
default_model_id = "grok-4"
allowed_model_ids = ["grok-4"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;

  const options = createProviderOptionsForWebTools({
    modelType: "xai",
    providerModelId: "grok-4",
    webToolsEnabled: true,
    capabilities: {
      tools: true,
      reasoning: false,
      temperature: true,
      attachments: false,
      structuredOutput: false,
    },
    reasoning: {
      enabled: true,
      effort: "medium",
      exposeToClient: false,
      openaiSummary: null,
      anthropicBudgetTokens: null,
      googleThinkingBudget: null,
    },
  });

  assert.deepEqual(options, {
    xai: {
      searchParameters: {
        mode: "on",
        returnCitations: true,
        sources: [
          {
            type: "web",
            allowedWebsites: ["arxiv.org", "openai.com"],
          },
        ],
      },
    },
  });
});
