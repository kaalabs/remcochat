import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { nanoid } from "nanoid";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests, getDb } from "../src/server/db";
import { getSkillsUsageSummary } from "../src/server/skills/usage";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_DB_PATH = process.env.REMCOCHAT_DB_PATH;

function writeTempConfigToml() {
  const filePath = path.join(
    os.tmpdir(),
    `remcochat-config-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`
  );
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

function setTempDbPath() {
  process.env.REMCOCHAT_DB_PATH = path.join(
    os.tmpdir(),
    `remcochat-skills-usage-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );
}

afterEach(() => {
  _resetDbForTests();
  _resetConfigCacheForTests();
  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.REMCOCHAT_CONFIG_PATH;
  else process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
  if (ORIGINAL_DB_PATH === undefined) delete process.env.REMCOCHAT_DB_PATH;
  else process.env.REMCOCHAT_DB_PATH = ORIGINAL_DB_PATH;
});

test("skills usage summary counts activated skills across chats", () => {
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetConfigCacheForTests();
  setTempDbPath();
  const db = getDb();

  const now = new Date().toISOString();
  const profileId = nanoid();
  db.prepare(
    `INSERT INTO profiles (id, name, created_at, default_model_id) VALUES (?, ?, ?, ?)`
  ).run(profileId, "Test", now, "gpt-5-nano");

  const insertChat = db.prepare(
    `INSERT INTO chats (id, profile_id, title, model_id, activated_skill_names_json, created_at, updated_at)
     VALUES (?, ?, '', ?, ?, ?, ?)`
  );

  insertChat.run(nanoid(), profileId, "gpt-5-nano", JSON.stringify([]), now, now);
  insertChat.run(
    nanoid(),
    profileId,
    "gpt-5-nano",
    JSON.stringify(["skills-system-validation", "hue-instant-control"]),
    now,
    now
  );
  insertChat.run(
    nanoid(),
    profileId,
    "gpt-5-nano",
    JSON.stringify(["skills-system-validation"]),
    now,
    now
  );

  const summary = getSkillsUsageSummary();
  assert.equal(summary.chatsWithAnyActivatedSkills, 2);
  assert.equal(summary.activatedSkillCounts["skills-system-validation"], 2);
  assert.equal(summary.activatedSkillCounts["hue-instant-control"], 1);
});
