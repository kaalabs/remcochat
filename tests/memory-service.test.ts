import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import {
  createMemoryItem,
  deleteMemoryItem,
  getMemoryItem,
  listProfileMemory,
} from "../src/server/memory-service";
import { createProfile } from "../src/server/profiles";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_DB_PATH = process.env.REMCOCHAT_DB_PATH;

function makeTempPath(prefix: string, ext: string) {
  return path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
}

function writeTempConfigToml() {
  const filePath = makeTempPath("remcochat-config", ".toml");
  fs.writeFileSync(
    filePath,
    `
version = 2

[app]
default_provider_id = "vercel"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`.trim() + "\n",
    "utf8",
  );
  return filePath;
}

afterEach(() => {
  _resetConfigCacheForTests();
  _resetDbForTests();

  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.REMCOCHAT_CONFIG_PATH;
  else process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;

  if (ORIGINAL_DB_PATH === undefined) delete process.env.REMCOCHAT_DB_PATH;
  else process.env.REMCOCHAT_DB_PATH = ORIGINAL_DB_PATH;
});

test("memory service creates, fetches, lists, and deletes memory items", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "Planner" });

  const created = createMemoryItem({
    profileId: profile.id,
    content: "  Loves oat milk  ",
  });
  assert.equal(created.content, "Loves oat milk");

  const fetched = getMemoryItem(profile.id, created.id);
  assert.deepEqual(fetched, created);

  const listed = listProfileMemory(profile.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, created.id);

  deleteMemoryItem(profile.id, created.id);
  assert.deepEqual(listProfileMemory(profile.id), []);
  assert.throws(
    () => getMemoryItem(profile.id, created.id),
    /Memory item not found\./,
  );
});

test("memory service preserves content and profile validation", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "Planner" });

  assert.throws(
    () => createMemoryItem({ profileId: profile.id, content: "   " }),
    /Memory content is required\./,
  );
  assert.throws(
    () => createMemoryItem({ profileId: profile.id, content: "x".repeat(4001) }),
    /Memory content is too long\./,
  );
  assert.throws(
    () => createMemoryItem({ profileId: "missing", content: "Tea" }),
    /Profile not found\./,
  );
});
