import type { Profile, UiLanguage } from "@/lib/types";
import { normalizeUiLanguage } from "@/lib/i18n";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { getActiveProviderConfig } from "@/server/model-registry";
import { deleteAttachmentsForProfile } from "@/server/attachments";
import { deleteProfileAvatar } from "@/server/profile-avatars";

type ProfileRow = {
  id: string;
  name: string;
  created_at: string;
  default_model_id: string;
  custom_instructions: string;
  custom_instructions_revision: number;
  memory_enabled: 0 | 1;
  ui_language: string;
  avatar_media_type: string | null;
  avatar_size_bytes: number | null;
  avatar_updated_at: string | null;
  avatar_pos_x: number | null;
  avatar_pos_y: number | null;
};

function rowToProfile(row: ProfileRow): Profile {
  const { provider } = getActiveProviderConfig();
  const allowed = new Set(provider.allowedModelIds);
  const defaultModelId = allowed.has(String(row.default_model_id))
    ? String(row.default_model_id)
    : provider.defaultModelId;
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    defaultModelId,
    customInstructions: String(row.custom_instructions ?? ""),
    customInstructionsRevision: Number(row.custom_instructions_revision ?? 1),
    memoryEnabled: Boolean(row.memory_enabled),
    uiLanguage: normalizeUiLanguage(row.ui_language, "en"),
    avatar:
      row.avatar_media_type && row.avatar_updated_at
        ? {
            mediaType: String(row.avatar_media_type),
            sizeBytes: Number(row.avatar_size_bytes ?? 0),
            updatedAt: String(row.avatar_updated_at),
            position: {
              x: (() => {
                const v = Number(row.avatar_pos_x ?? 50);
                return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50;
              })(),
              y: (() => {
                const v = Number(row.avatar_pos_y ?? 50);
                return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50;
              })(),
            },
          }
        : null,
  };
}

export function listProfiles(opts?: { seedUiLanguage?: UiLanguage }): Profile[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, created_at, default_model_id,
              custom_instructions, custom_instructions_revision,
              memory_enabled, ui_language,
              avatar_media_type, avatar_size_bytes, avatar_updated_at, avatar_pos_x, avatar_pos_y
       FROM profiles
       ORDER BY created_at ASC`
    )
    .all() as ProfileRow[];

  if (rows.length > 0) {
    return rows.map(rowToProfile);
  }

  const now = new Date().toISOString();
  const id = nanoid();
  const { provider } = getActiveProviderConfig();
  const uiLanguage = normalizeUiLanguage(opts?.seedUiLanguage, "en");

  db.prepare(
    `INSERT INTO profiles (id, name, created_at, default_model_id, custom_instructions, custom_instructions_revision, memory_enabled, ui_language)
     VALUES (?, ?, ?, ?, '', 1, 1, ?)`
  ).run(id, "Default", now, provider.defaultModelId, uiLanguage);

  return listProfiles();
}

export function createProfile(input: {
  name: string;
  defaultModelId?: string;
  uiLanguage?: UiLanguage;
}) {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Profile name is required.");
  }
  if (name.length > 80) {
    throw new Error("Profile name is too long.");
  }

  const { provider } = getActiveProviderConfig();
  const allowed = new Set(provider.allowedModelIds);
  const defaultModelId =
    typeof input.defaultModelId === "string" && allowed.has(input.defaultModelId)
      ? input.defaultModelId
      : provider.defaultModelId;
  const uiLanguage = normalizeUiLanguage(input.uiLanguage, "nl");

  const db = getDb();
  const now = new Date().toISOString();
  const id = nanoid();

  db.prepare(
    `INSERT INTO profiles (id, name, created_at, default_model_id, custom_instructions, custom_instructions_revision, memory_enabled, ui_language)
     VALUES (?, ?, ?, ?, '', 1, 1, ?)`
  ).run(id, name, now, defaultModelId, uiLanguage);

  return getProfile(id);
}

export function getProfile(id: string): Profile {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, created_at, default_model_id,
              custom_instructions, custom_instructions_revision,
              memory_enabled, ui_language,
              avatar_media_type, avatar_size_bytes, avatar_updated_at, avatar_pos_x, avatar_pos_y
       FROM profiles WHERE id = ?`
    )
    .get(id) as ProfileRow | undefined;

  if (!row) throw new Error("Profile not found.");
  return rowToProfile(row);
}

export function updateProfile(
  id: string,
  patch: Partial<
    Pick<
      Profile,
      "name" | "defaultModelId" | "customInstructions" | "memoryEnabled" | "uiLanguage"
    >
  >
): Profile {
  const db = getDb();
  const current = getProfile(id);

  const name =
    patch.name != null ? patch.name.trim() : current.name;
  if (name.length === 0) throw new Error("Profile name is required.");
  if (name.length > 80) throw new Error("Profile name is too long.");

  const defaultModelId =
    patch.defaultModelId != null
      ? (() => {
          const { provider } = getActiveProviderConfig();
          const allowed = new Set(provider.allowedModelIds);
          return allowed.has(patch.defaultModelId)
            ? patch.defaultModelId
            : provider.defaultModelId;
        })()
      : current.defaultModelId;

  const customInstructions =
    patch.customInstructions != null
      ? String(patch.customInstructions)
      : current.customInstructions;

  const customInstructionsRevision =
    patch.customInstructions != null && customInstructions !== current.customInstructions
      ? current.customInstructionsRevision + 1
      : current.customInstructionsRevision;

  const memoryEnabled =
    patch.memoryEnabled != null
      ? patch.memoryEnabled
        ? 1
        : 0
      : current.memoryEnabled
        ? 1
        : 0;

  const uiLanguage = normalizeUiLanguage(patch.uiLanguage, current.uiLanguage);

  db.prepare(
    `UPDATE profiles
     SET name = ?, default_model_id = ?, custom_instructions = ?, custom_instructions_revision = ?, memory_enabled = ?, ui_language = ?
     WHERE id = ?`
  ).run(
    name,
    defaultModelId,
    customInstructions,
    customInstructionsRevision,
    memoryEnabled,
    uiLanguage,
    id
  );

  return getProfile(id);
}

export async function deleteProfile(id: string) {
  const db = getDb();
  // Ensure we surface a consistent "not found" error.
  getProfile(id);
  await deleteProfileAvatar(id).catch(() => {});
  await deleteAttachmentsForProfile(id);
  db.prepare(`DELETE FROM profiles WHERE id = ?`).run(id);
}
