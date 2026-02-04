import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import { createChat, listAccessibleChats, updateChatForProfile } from "../src/server/chats";
import {
  createFolder,
  listAccessibleFolders,
  listFolderMembers,
  shareFolder,
  unshareFolder,
  updateFolderForViewer,
} from "../src/server/folders";
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

test("shared folders: share/unshare invariants (owner-only, no self, idempotent)", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const owner = createProfile({ name: "Owner" });
  const member = createProfile({ name: "Member" });
  const other = createProfile({ name: "Other" });

  const folder = createFolder(owner.id, { name: "Work" });

  // Only owner can share/unshare.
  assert.throws(
    () => shareFolder(member.id, folder.id, { targetProfile: other.name }),
    /Folder not found\./
  );
  assert.throws(
    () => unshareFolder(member.id, folder.id, { targetProfile: other.name }),
    /Folder not found\./
  );

  // Cannot share with self (owner).
  assert.throws(
    () => shareFolder(owner.id, folder.id, { targetProfile: owner.id }),
    /share a folder with its owner/i
  );

  // Idempotent.
  shareFolder(owner.id, folder.id, { targetProfile: member.id });
  shareFolder(owner.id, folder.id, { targetProfile: member.id });
  assert.equal(listFolderMembers(owner.id, folder.id).length, 1);

  unshareFolder(owner.id, folder.id, { targetProfile: member.id });
  assert.equal(listFolderMembers(owner.id, folder.id).length, 0);
});

test("shared folders: derived chat access (shared via folder membership)", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const owner = createProfile({ name: "Owner" });
  const member = createProfile({ name: "Member" });

  const folder = createFolder(owner.id, { name: "Work" });
  const chat = createChat({ profileId: owner.id, title: "Spec draft" });
  updateChatForProfile(owner.id, chat.id, { folderId: folder.id });

  shareFolder(owner.id, folder.id, { targetProfile: member.id });

  const memberFolders = listAccessibleFolders(member.id);
  assert.ok(memberFolders.some((f) => f.id === folder.id && f.scope === "shared"));

  const memberChats = listAccessibleChats(member.id);
  assert.ok(memberChats.some((c) => c.id === chat.id && c.scope === "shared"));

  // Moving the chat out of the shared folder stops sharing.
  updateChatForProfile(owner.id, chat.id, { folderId: null });
  const memberChatsAfter = listAccessibleChats(member.id);
  assert.ok(!memberChatsAfter.some((c) => c.id === chat.id));
});

test("shared folders: per-recipient collapsed state is independent from owner", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const owner = createProfile({ name: "Owner" });
  const member = createProfile({ name: "Member" });

  const folder = createFolder(owner.id, { name: "Work" });
  shareFolder(owner.id, folder.id, { targetProfile: member.id });

  // Owner collapses their folder.
  updateFolderForViewer(owner.id, folder.id, { collapsed: true });

  // Member starts expanded, then collapses their own view.
  const before = listAccessibleFolders(member.id).find((f) => f.id === folder.id);
  assert.ok(before);
  assert.equal(before.collapsed, false);

  updateFolderForViewer(member.id, folder.id, { collapsed: true });

  const after = listAccessibleFolders(member.id).find((f) => f.id === folder.id);
  assert.ok(after);
  assert.equal(after.collapsed, true);

  // Owner remains collapsed regardless of member state.
  const ownerView = listAccessibleFolders(owner.id).find((f) => f.id === folder.id);
  assert.ok(ownerView);
  assert.equal(ownerView.collapsed, true);
});
