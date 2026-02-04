import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import {
  createChat,
  listAccessibleChats,
  pinChat,
  unpinChat,
  updateChatForProfile,
} from "../src/server/chats";
import { createFolder, shareFolder } from "../src/server/folders";
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

test("chat pins: pinned chats sort above unpinned for the viewer profile", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });
  const older = createChat({ profileId: profile.id, title: "Older" });
  const newer = createChat({ profileId: profile.id, title: "Newer" });

  const before = listAccessibleChats(profile.id).filter((c) => !c.archivedAt);
  assert.equal(before[0]?.id, newer.id);
  assert.equal(before[1]?.id, older.id);

  pinChat(profile.id, older.id);

  const afterPin = listAccessibleChats(profile.id).filter((c) => !c.archivedAt);
  assert.equal(afterPin[0]?.id, older.id);
  assert.ok(typeof afterPin[0]?.pinnedAt === "string" && afterPin[0]!.pinnedAt);

  unpinChat(profile.id, older.id);

  const afterUnpin = listAccessibleChats(profile.id).filter((c) => !c.archivedAt);
  assert.equal(afterUnpin[0]?.id, newer.id);
  const olderEntry = afterUnpin.find((c) => c.id === older.id);
  assert.equal(olderEntry?.pinnedAt, null);
});

test("chat pins: pinning is per-profile (does not affect other viewers)", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const p1 = createProfile({ name: "Owner" });
  const p2 = createProfile({ name: "Viewer" });

  const folder = createFolder(p1.id, { name: "Shared" });
  shareFolder(p1.id, folder.id, { targetProfile: p2.id });

  const chat = createChat({ profileId: p1.id, title: "In shared folder" });
  updateChatForProfile(p1.id, chat.id, { folderId: folder.id });

  pinChat(p1.id, chat.id);

  const viewerBefore = listAccessibleChats(p2.id).find((c) => c.id === chat.id);
  assert.equal(viewerBefore?.scope, "shared");
  assert.equal(viewerBefore?.pinnedAt, null);

  pinChat(p2.id, chat.id);

  const viewerAfter = listAccessibleChats(p2.id).find((c) => c.id === chat.id);
  assert.ok(typeof viewerAfter?.pinnedAt === "string" && viewerAfter!.pinnedAt);
});

