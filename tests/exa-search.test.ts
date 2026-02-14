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

test("Exa search tool forces type=instant", async () => {
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

  let seenBody: any = null;
  globalThis.fetch = (async (_url: any, init?: any) => {
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        requestId: "test",
        results: [{ url: "https://example.com", text: "t", highlights: ["h"] }],
      }),
      text: async () => "",
    } as any;
  }) as any;

  const tool = createExaSearchTool() as unknown as {
    execute: (args: { query: string; num_results: number; type?: string }) => Promise<unknown>;
  };
  await tool.execute({ query: "OpenAI", num_results: 1, type: "deep" });

  assert.equal(seenBody?.type, "instant");
});

