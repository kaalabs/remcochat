import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { createSkillsTools } from "../src/ai/skills-tools";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests, getDb } from "../src/server/db";
import { _resetSkillsRegistryForTests } from "../src/server/skills/runtime";
import { createProfile } from "../src/server/profiles";
import { createChat, getChat } from "../src/server/chats";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_DB_PATH = process.env.REMCOCHAT_DB_PATH;

function makeTempPath(prefix: string, ext: string) {
  return path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`
  );
}

function writeTempConfigToml(input: { skillsDir: string }) {
  const filePath = makeTempPath("remcochat-config", ".toml");
  fs.writeFileSync(
    filePath,
    `
version = 2

[app]
default_provider_id = "vercel"

[app.skills]
enabled = true
directories = ["${input.skillsDir.replaceAll("\\", "\\\\")}"]

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

function writeSkillFixture(input: { skillsRoot: string; skillName: string }) {
  const dir = path.join(input.skillsRoot, input.skillName);
  fs.mkdirSync(dir, { recursive: true });

  const skillMd = [
    "---",
    `name: ${input.skillName}`,
    "description: skills persistence fixture",
    "---",
    "",
    "# Body",
    "",
    "x".repeat(10_000),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd, "utf8");

  return dir;
}

afterEach(() => {
  _resetSkillsRegistryForTests();
  _resetConfigCacheForTests();
  _resetDbForTests();

  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.REMCOCHAT_CONFIG_PATH;
  else process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;

  if (ORIGINAL_DB_PATH === undefined) delete process.env.REMCOCHAT_DB_PATH;
  else process.env.REMCOCHAT_DB_PATH = ORIGINAL_DB_PATH;
});

test("activated skill names persist and store names only", async () => {
  const dbPath = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_DB_PATH = dbPath;

  const skillsRoot = makeTempPath("remcochat-skills", "");
  fs.mkdirSync(skillsRoot, { recursive: true });
  writeSkillFixture({ skillsRoot, skillName: "my-skill" });

  const cfgPath = writeTempConfigToml({ skillsDir: skillsRoot });
  process.env.REMCOCHAT_CONFIG_PATH = cfgPath;

  _resetDbForTests();
  _resetConfigCacheForTests();
  _resetSkillsRegistryForTests();

  const profile = createProfile({ name: "P1" });
  const chat = createChat({ profileId: profile.id });

  const tools = createSkillsTools({ enabled: true, chatId: chat.id }).tools as Record<
    string,
    any
  >;
  const activate = tools["skillsActivate"];
  assert.ok(activate);

  await activate.execute({ name: "my-skill" });

  _resetDbForTests();
  const refreshed = getChat(chat.id);
  assert.deepEqual(refreshed.activatedSkillNames, ["my-skill"]);

  const directDb = new Database(dbPath);
  const row = directDb
    .prepare(`SELECT activated_skill_names_json FROM chats WHERE id = ?`)
    .get(chat.id) as { activated_skill_names_json: string };
  directDb.close();

  assert.equal(row.activated_skill_names_json, JSON.stringify(["my-skill"]));
  assert.ok(!row.activated_skill_names_json.includes("x"));
});

test("migration adds activated_skill_names_json when missing", () => {
  const dbPath = makeTempPath("remcochat-db-migrate", ".sqlite");
  process.env.REMCOCHAT_DB_PATH = dbPath;

  const db = new Database(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      chat_instructions TEXT NOT NULL DEFAULT '',
      chat_instructions_revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT,
      forked_from_chat_id TEXT,
      forked_from_message_id TEXT
    );
  `);
  db.close();

  const cfgPath = writeTempConfigToml({ skillsDir: path.resolve(process.cwd(), ".skills") });
  process.env.REMCOCHAT_CONFIG_PATH = cfgPath;

  _resetDbForTests();
  _resetConfigCacheForTests();
  getDb();

  const migrated = new Database(dbPath);
  const cols = migrated.prepare(`PRAGMA table_info(chats)`).all() as Array<{ name: string }>;
  migrated.close();

  assert.ok(cols.some((c) => c.name === "activated_skill_names_json"));
});
