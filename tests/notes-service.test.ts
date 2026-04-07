import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import { createProfile } from "../src/server/profiles";
import {
  listProfileNotes,
  runNoteAction,
} from "../src/server/notes-service";

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

test("notes service creates, shows, and deletes notes through the public facade", async () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });

  const createdFirst = runNoteAction(profile.id, {
    action: "create",
    content: "  First note\r\n\r\n\r\nBody  ",
    limit: 10,
  });
  assert.equal(createdFirst.totalCount, 1);
  assert.equal(createdFirst.notes[0]?.content, "First note\n\nBody");

  await new Promise((resolve) => setTimeout(resolve, 5));

  runNoteAction(profile.id, {
    action: "create",
    content: "Second note",
    limit: 10,
  });

  const shown = runNoteAction(profile.id, {
    action: "show",
    limit: 1,
  });
  assert.equal(shown.limit, 1);
  assert.equal(shown.totalCount, 2);
  assert.equal(shown.notes.length, 1);
  assert.equal(shown.notes[0]?.content, "Second note");

  const afterDelete = runNoteAction(profile.id, {
    action: "delete",
    noteIndex: 1,
    limit: 10,
  });
  assert.equal(afterDelete.totalCount, 1);
  assert.deepEqual(
    afterDelete.notes.map((note) => note.content),
    ["First note\n\nBody"],
  );
  assert.deepEqual(
    listProfileNotes(profile.id, 20).map((note) => note.content),
    ["First note\n\nBody"],
  );
});

test("notes service preserves validation and limit behavior", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });

  const shown = runNoteAction(profile.id, {
    action: "show",
    limit: 999,
  });
  assert.equal(shown.limit, 20);
  assert.equal(shown.totalCount, 0);

  assert.throws(
    () => runNoteAction(profile.id, { action: "create", content: "   " }),
    /Note content is required\./,
  );
  assert.throws(
    () => runNoteAction(profile.id, { action: "create", content: "x".repeat(4001) }),
    /Note is too long\./,
  );
  assert.throws(
    () => runNoteAction(profile.id, { action: "delete" }),
    /Note id or index is required\./,
  );
});
