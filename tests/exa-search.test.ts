import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { createExaSearchTool } from "../src/ai/exa-search";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_EXA_API_KEY = process.env.EXA_API_KEY;
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
  if (ORIGINAL_CONFIG_PATH === undefined) {
    delete process.env.REMCOCHAT_CONFIG_PATH;
  } else {
    process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
  }
  if (ORIGINAL_EXA_API_KEY === undefined) {
    delete process.env.EXA_API_KEY;
  } else {
    process.env.EXA_API_KEY = ORIGINAL_EXA_API_KEY;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

test("Exa search tool preserves normalized result shape", async () => {
  process.env.EXA_API_KEY = "test";
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "opencode"

[providers.opencode]
name = "OpenCode"
api_key_env = "OPENCODE_API_KEY"
base_url = "https://example.com"
default_model_id = "gpt-5.2"
allowed_model_ids = ["gpt-5.2"]
`);

  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        requestId: "req_123",
        type: "instant",
        results: [
          {
            url: "https://example.com",
            title: "Example",
            text: "Body",
            highlights: ["One"],
          },
        ],
      }),
      text: async () => "",
    } as any;
  }) as any;

  const tool = createExaSearchTool() as unknown as {
    execute: (args: { query: string; num_results?: number }) => Promise<any>;
  };
  const result = await tool.execute({ query: "OpenAI", num_results: 1 });

  assert.deepEqual(result, {
    requestId: "req_123",
    searchType: "instant",
    results: [
      {
        title: "Example",
        url: "https://example.com",
        id: "",
        publishedDate: "",
        author: "",
        text: "Body",
        highlights: ["One"],
      },
    ],
    costDollars: null,
  });
});

test("Exa search tool applies allowed-domain config fallback", async () => {
  process.env.EXA_API_KEY = "test";
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "opencode"

[providers.opencode]
name = "OpenCode"
api_key_env = "OPENCODE_API_KEY"
base_url = "https://example.com"
default_model_id = "gpt-5.2"
allowed_model_ids = ["gpt-5.2"]

[app.web_tools]
enabled = true
search_provider = "exa"
allowed_domains = ["docs.example.com"]
`);

  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init?: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        requestId: "req_123",
        type: "instant",
        results: [],
      }),
      text: async () => "",
    } as any;
  }) as any;

  const tool = createExaSearchTool() as unknown as {
    execute: (args: { query: string; num_results?: number }) => Promise<any>;
  };
  await tool.execute({ query: "OpenAI", num_results: 3 });

  assert.deepEqual(seenBody?.includeDomains, ["docs.example.com"]);
  assert.equal(seenBody?.excludeDomains, undefined);
  assert.equal(seenBody?.numResults, 3);
  assert.equal(seenBody?.type, "fast");
  assert.equal(seenBody?.contents?.text?.maxCharacters, 15000);
});
