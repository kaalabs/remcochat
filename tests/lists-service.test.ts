import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import { createProfile } from "../src/server/profiles";
import {
  listProfileListOverviews,
  listProfileLists,
  runListAction,
} from "../src/server/lists-service";

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

test("lists service manages item workflow through the public facade", async () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });

  const created = runListAction(profile.id, {
    action: "create",
    listName: "  boodschappen lijst  ",
    items: [" Milk  ", "Eggs "],
  });
  assert.equal(created.kind, "grocery");
  assert.equal(created.name, "boodschappen lijst");
  assert.deepEqual(
    created.items.map((item) => ({ content: item.content, completed: item.completed })),
    [
      { content: "Milk", completed: false },
      { content: "Eggs", completed: false },
    ],
  );

  await new Promise((resolve) => setTimeout(resolve, 5));

  const toggled = runListAction(profile.id, {
    action: "toggle_items",
    listId: created.id,
    items: ["milk"],
  });
  assert.equal(
    toggled.items.find((item) => item.content === "Milk")?.completed,
    true,
  );

  const renamed = runListAction(profile.id, {
    action: "rename_list",
    listId: created.id,
    newName: "Weekend groceries",
  });
  assert.equal(renamed.name, "Weekend groceries");

  const removed = runListAction(profile.id, {
    action: "remove_items",
    listId: created.id,
    items: ["eggs"],
  });
  assert.deepEqual(
    removed.items.map((item) => item.content),
    ["Milk"],
  );

  const deleted = runListAction(profile.id, {
    action: "delete_list",
    listId: created.id,
  });
  assert.equal(deleted.deleted, true);
  assert.deepEqual(deleted.items, []);
  assert.deepEqual(listProfileLists(profile.id), []);
});

test("lists service shares overviews and preserves owner-only mutations", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const owner = createProfile({ name: "Owner" });
  const guest = createProfile({ name: "Guest" });

  const created = runListAction(owner.id, {
    action: "create",
    listName: "Weekend plans",
    items: ["Pack bag"],
  });

  runListAction(owner.id, {
    action: "share_list",
    listId: created.id,
    targetProfile: "Guest",
  });

  const guestLists = listProfileLists(guest.id);
  assert.equal(guestLists.length, 1);
  assert.equal(guestLists[0]?.profileId, owner.id);
  assert.equal(guestLists[0]?.sharedCount, 1);

  const guestOverview = listProfileListOverviews(guest.id)[0];
  assert.equal(guestOverview?.scope, "shared");
  assert.equal(guestOverview?.ownerProfileId, owner.id);
  assert.equal(guestOverview?.ownerProfileName, "Owner");

  assert.throws(
    () =>
      runListAction(guest.id, {
        action: "rename_list",
        listId: created.id,
        newName: "Nope",
      }),
    /Only the list owner can rename it\./,
  );

  runListAction(owner.id, {
    action: "unshare_list",
    listId: created.id,
    targetProfile: "Guest",
  });

  assert.deepEqual(listProfileLists(guest.id), []);
  assert.deepEqual(
    listProfileListOverviews(owner.id).map((overview) => overview.scope),
    ["owned"],
  );
});
