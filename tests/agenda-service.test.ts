import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import {
  listProfileAgendaItems,
  runAgendaAction,
} from "../src/server/agenda";
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

test("agenda service manages create, match-based update, list, and delete", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "Planner" });

  const created = runAgendaAction(profile.id, {
    action: "create",
    description: "  Team sync  ",
    date: "2026-04-02",
    time: "09:30",
    durationMinutes: 45,
    timezone: "UTC",
  });
  assert.equal(created.ok, true);
  assert.equal(created.action, "create");
  assert.equal(created.item?.description, "Team sync");
  assert.equal(created.item?.timezone, "UTC");
  assert.equal(created.item?.localDate, "2026-04-02");
  assert.equal(created.item?.localTime, "09:30");

  const listed = runAgendaAction(profile.id, {
    action: "list",
    range: { kind: "next_n_days", days: 365, timezone: "UTC" },
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.action, "list");
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.id, created.item?.id);

  const updated = runAgendaAction(profile.id, {
    action: "update",
    match: {
      description: "team sync",
      date: "2026-04-02",
      time: "09:30",
    },
    patch: {
      description: "Project sync",
      time: "10:00",
    },
  }, { viewerTimeZone: "UTC" });
  assert.equal(updated.ok, true);
  assert.equal(updated.action, "update");
  assert.equal(updated.item?.description, "Project sync");
  assert.equal(updated.item?.localTime, "10:00");

  const deleted = runAgendaAction(profile.id, {
    action: "delete",
    itemId: updated.item?.id,
  });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.action, "delete");
  assert.equal(deleted.item?.description, "Project sync");
  assert.deepEqual(listProfileAgendaItems(profile.id), []);
});

test("agenda service shares items while preserving owner-only mutations", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const owner = createProfile({ name: "Owner" });
  const guest = createProfile({ name: "Guest" });

  const created = runAgendaAction(owner.id, {
    action: "create",
    description: "Train to Utrecht",
    date: "2026-04-03",
    time: "08:15",
    durationMinutes: 30,
    timezone: "UTC",
  });
  assert.equal(created.ok, true);
  assert.equal(created.action, "create");

  const shared = runAgendaAction(owner.id, {
    action: "share",
    itemId: created.item?.id,
    targetProfile: "Guest",
  });
  assert.equal(shared.ok, true);
  assert.equal(shared.action, "share");
  assert.equal(shared.item?.sharedWithCount, 1);

  const guestAgenda = listProfileAgendaItems(guest.id);
  assert.equal(guestAgenda.length, 1);
  assert.equal(guestAgenda[0]?.scope, "shared");
  assert.equal(guestAgenda[0]?.ownerProfileId, owner.id);
  assert.equal(guestAgenda[0]?.ownerProfileName, "Owner");
  assert.equal(guestAgenda[0]?.sharedWithCount, 1);

  assert.throws(
    () =>
      runAgendaAction(guest.id, {
        action: "update",
        itemId: created.item?.id,
        patch: { description: "Missed train" },
      }),
    /Only the item owner can modify it\./,
  );

  const unshared = runAgendaAction(owner.id, {
    action: "unshare",
    itemId: created.item?.id,
    targetProfile: "Guest",
  });
  assert.equal(unshared.ok, true);
  assert.equal(unshared.action, "unshare");
  assert.equal(unshared.item?.sharedWithCount, 0);
  assert.deepEqual(listProfileAgendaItems(guest.id), []);
});
