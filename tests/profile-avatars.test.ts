import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import { createProfile, deleteProfile, getProfile } from "../src/server/profiles";
import {
  deleteProfileAvatar,
  setProfileAvatar,
  updateProfileAvatarPosition,
} from "../src/server/profile-avatars";
import { MAX_PROFILE_AVATAR_SIZE_BYTES } from "../src/lib/profile-avatar-constraints";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_DB_PATH = process.env.REMCOCHAT_DB_PATH;
const ORIGINAL_AVATAR_DIR = process.env.REMCOCHAT_PROFILE_AVATARS_DIR;

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

  if (ORIGINAL_AVATAR_DIR === undefined) delete process.env.REMCOCHAT_PROFILE_AVATARS_DIR;
  else process.env.REMCOCHAT_PROFILE_AVATARS_DIR = ORIGINAL_AVATAR_DIR;
});

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X6WZ0AAAAASUVORK5CYII=",
  "base64"
);

test("profile avatars: upload stores metadata + file, position updates, delete removes", async () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  process.env.REMCOCHAT_PROFILE_AVATARS_DIR = makeTempPath("remcochat-avatars", "");
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });

  await setProfileAvatar(profile.id, {
    bytes: ONE_BY_ONE_PNG,
    mediaType: "image/png",
    position: { x: 12, y: 34 },
  });

  const withAvatar = getProfile(profile.id);
  assert.ok(withAvatar.avatar);
  assert.equal(withAvatar.avatar.mediaType, "image/png");
  assert.equal(withAvatar.avatar.position.x, 12);
  assert.equal(withAvatar.avatar.position.y, 34);

  const avatarFilePath = path.join(process.env.REMCOCHAT_PROFILE_AVATARS_DIR!, profile.id);
  assert.ok(fs.existsSync(avatarFilePath));

  updateProfileAvatarPosition(profile.id, { x: 90, y: 10 });
  const moved = getProfile(profile.id);
  assert.ok(moved.avatar);
  assert.equal(moved.avatar.position.x, 90);
  assert.equal(moved.avatar.position.y, 10);

  await deleteProfileAvatar(profile.id);
  const removed = getProfile(profile.id);
  assert.equal(removed.avatar, null);
  assert.ok(!fs.existsSync(avatarFilePath));
});

test("profile avatars: rejects unsupported media types and oversized files", async () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  process.env.REMCOCHAT_PROFILE_AVATARS_DIR = makeTempPath("remcochat-avatars", "");
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });

  await assert.rejects(
    () =>
      setProfileAvatar(profile.id, {
        bytes: ONE_BY_ONE_PNG,
        mediaType: "image/gif",
      }),
    /Unsupported avatar type/
  );

  await assert.rejects(
    () =>
      setProfileAvatar(profile.id, {
        bytes: Buffer.alloc(MAX_PROFILE_AVATAR_SIZE_BYTES + 1, 0),
        mediaType: "image/png",
      }),
    /File is too large/
  );
});

test("profile avatars: deleting a profile removes its avatar file", async () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  process.env.REMCOCHAT_PROFILE_AVATARS_DIR = makeTempPath("remcochat-avatars", "");
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });
  await setProfileAvatar(profile.id, {
    bytes: ONE_BY_ONE_PNG,
    mediaType: "image/png",
  });

  const avatarFilePath = path.join(process.env.REMCOCHAT_PROFILE_AVATARS_DIR!, profile.id);
  assert.ok(fs.existsSync(avatarFilePath));

  await deleteProfile(profile.id);
  assert.ok(!fs.existsSync(avatarFilePath));
});

