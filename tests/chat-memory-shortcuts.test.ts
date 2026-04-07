import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { createChat } from "../src/server/chats";
import { _resetDbForTests } from "../src/server/db";
import { maybeCreatePersistedMemoryPromptResponse } from "../src/server/chat/memory-shortcuts";
import { getPendingMemory } from "../src/server/pending-memory";
import { createProfile, updateProfile } from "../src/server/profiles";

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

async function responseText(response: Response) {
  return await response.text();
}

afterEach(() => {
  _resetConfigCacheForTests();
  _resetDbForTests();

  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.REMCOCHAT_CONFIG_PATH;
  else process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;

  if (ORIGINAL_DB_PATH === undefined) delete process.env.REMCOCHAT_DB_PATH;
  else process.env.REMCOCHAT_DB_PATH = ORIGINAL_DB_PATH;
});

test("maybeCreatePersistedMemoryPromptResponse stores pending memory and returns a memory prompt stream", async () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });
  const chat = createChat({ profileId: profile.id });

  const response = maybeCreatePersistedMemoryPromptResponse({
    candidate: "  my office is on the third floor  ",
    chatId: chat.id,
    profile: {
      id: profile.id,
      memoryEnabled: true,
    },
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: { "x-remcochat-test": "1" },
  });

  assert.ok(response);
  assert.equal(response.headers.get("x-remcochat-test"), "1");
  assert.equal(getPendingMemory(chat.id)?.content, "my office is on the third floor");

  const text = await responseText(response);
  assert.match(text, /displayMemoryPrompt/);
  assert.match(text, /my office is on the third floor/);
});

test("maybeCreatePersistedMemoryPromptResponse returns the disabled-memory guard without creating pending state", async () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = updateProfile(createProfile({ name: "P1" }).id, {
    memoryEnabled: false,
  });
  const chat = createChat({ profileId: profile.id });

  const response = maybeCreatePersistedMemoryPromptResponse({
    candidate: "remember my timezone is Europe/Amsterdam",
    chatId: chat.id,
    profile: {
      id: profile.id,
      memoryEnabled: false,
    },
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: {},
  });

  assert.ok(response);
  assert.equal(getPendingMemory(chat.id), null);
  assert.match(
    await responseText(response),
    /Memory is currently off for this profile/,
  );
});

test("maybeCreatePersistedMemoryPromptResponse rejects vague or invalid candidates before saving pending memory", async () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });
  const chat = createChat({ profileId: profile.id });

  const vagueResponse = maybeCreatePersistedMemoryPromptResponse({
    candidate: "timezone",
    chatId: chat.id,
    profile: {
      id: profile.id,
      memoryEnabled: true,
    },
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: {},
  });
  assert.ok(vagueResponse);
  assert.equal(getPendingMemory(chat.id), null);
  assert.match(
    await responseText(vagueResponse),
    /I need a bit more context to store this memory/,
  );

  const longResponse = maybeCreatePersistedMemoryPromptResponse({
    candidate: "word ".repeat(900),
    chatId: chat.id,
    profile: {
      id: profile.id,
      memoryEnabled: true,
    },
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: {},
  });
  assert.ok(longResponse);
  assert.equal(getPendingMemory(chat.id), null);
  assert.match(await responseText(longResponse), /Memory content is too long/);
});
