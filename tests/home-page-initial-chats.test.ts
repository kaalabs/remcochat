import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { getHomePageInitialChats } from "../src/app/home-page-initial-chats";
import { createChat, listChats, updateChatForProfile } from "../src/server/chats";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import { createFolder, shareFolder } from "../src/server/folders";
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

function resetTestEnv() {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();
}

afterEach(() => {
  _resetConfigCacheForTests();
  _resetDbForTests();

  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.REMCOCHAT_CONFIG_PATH;
  else process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;

  if (ORIGINAL_DB_PATH === undefined) delete process.env.REMCOCHAT_DB_PATH;
  else process.env.REMCOCHAT_DB_PATH = ORIGINAL_DB_PATH;
});

test("getHomePageInitialChats returns shared chats without creating a new owned chat", () => {
  resetTestEnv();

  const owner = createProfile({ name: "Owner" });
  const member = createProfile({ name: "Member" });

  const folder = createFolder(owner.id, { name: "Shared work" });
  const ownedChat = createChat({ profileId: owner.id, title: "Spec draft" });
  updateChatForProfile(owner.id, ownedChat.id, { folderId: folder.id });
  shareFolder(owner.id, folder.id, { targetProfile: member.id });

  const initialChats = getHomePageInitialChats(member.id);

  assert.equal(initialChats.length, 1);
  assert.equal(initialChats[0]?.id, ownedChat.id);
  assert.equal(initialChats[0]?.scope, "shared");
  assert.equal(listChats(member.id).length, 0);
});

test("getHomePageInitialChats creates one owned chat when no accessible chats exist", () => {
  resetTestEnv();

  const profile = createProfile({ name: "Owner" });

  const initialChats = getHomePageInitialChats(profile.id);

  assert.equal(initialChats.length, 1);
  assert.equal(initialChats[0]?.scope, "owned");
  assert.equal(initialChats[0]?.profileId, profile.id);
  assert.equal(listChats(profile.id).length, 1);
});
