import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import { createChat, getChat, updateChatForProfile } from "../src/server/chats";
import { createFolder, deleteFolder, listFolders } from "../src/server/folders";
import { createProfile } from "../src/server/profiles";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_DB_PATH = process.env.REMCOCHAT_DB_PATH;

function makeTempPath(prefix: string, ext: string) {
  return path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`
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
    "utf8"
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

test("folders: name validation trims, rejects empty, enforces max length", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });

  const folder = createFolder(profile.id, { name: "  Work   " });
  assert.equal(folder.name, "Work");

  assert.throws(
    () => createFolder(profile.id, { name: "   " }),
    /Folder name is required\./
  );

  assert.throws(
    () => createFolder(profile.id, { name: "x".repeat(61) }),
    /Folder name is too long\./
  );
});

test("folders: deleting a folder moves chats to the root level", () => {
  const dbPath = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_DB_PATH = dbPath;
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });
  const chatA = createChat({ profileId: profile.id, title: "A" });
  const chatB = createChat({ profileId: profile.id, title: "B" });
  const folder = createFolder(profile.id, { name: "Work" });

  updateChatForProfile(profile.id, chatA.id, { folderId: folder.id });
  updateChatForProfile(profile.id, chatB.id, { folderId: folder.id });

  deleteFolder(profile.id, folder.id);

  const refreshedA = getChat(chatA.id);
  const refreshedB = getChat(chatB.id);
  assert.equal(refreshedA.folderId, null);
  assert.equal(refreshedB.folderId, null);
  assert.equal(listFolders(profile.id).length, 0);

  const directDb = new Database(dbPath);
  const rows = directDb
    .prepare(`SELECT folder_id FROM chats WHERE profile_id = ? ORDER BY created_at ASC`)
    .all(profile.id) as Array<{ folder_id: string | null }>;
  directDb.close();

  assert.ok(rows.length >= 2);
  assert.ok(rows.every((r) => r.folder_id === null));
});

test("folders: moving a chat to another profile's folder is rejected", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const p1 = createProfile({ name: "P1" });
  const p2 = createProfile({ name: "P2" });

  const chat = createChat({ profileId: p1.id, title: "A" });
  const foreignFolder = createFolder(p2.id, { name: "Work" });

  assert.throws(
    () => updateChatForProfile(p1.id, chat.id, { folderId: foreignFolder.id }),
    /Folder not found\./
  );
});

test("folders: moving a chat does not bump updated_at", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });
  const chat = createChat({ profileId: profile.id, title: "A" });
  const before = getChat(chat.id);
  const folder = createFolder(profile.id, { name: "Work" });

  updateChatForProfile(profile.id, chat.id, { folderId: folder.id });
  const after = getChat(chat.id);

  assert.equal(after.folderId, folder.id);
  assert.equal(after.updatedAt, before.updatedAt);
});

