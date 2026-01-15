import type { Profile } from "@/lib/types";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { getActiveProviderConfig } from "@/server/model-registry";

type ProfileRow = {
  id: string;
  name: string;
  created_at: string;
  default_model_id: string;
  custom_instructions: string;
  custom_instructions_revision: number;
  memory_enabled: 0 | 1;
};

function rowToProfile(row: ProfileRow): Profile {
  const { provider } = getActiveProviderConfig();
  const allowed = new Set(provider.models.map((m) => m.id));
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
  };
}

export function listProfiles(): Profile[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, created_at, default_model_id, custom_instructions, custom_instructions_revision, memory_enabled
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

  db.prepare(
    `INSERT INTO profiles (id, name, created_at, default_model_id, custom_instructions, custom_instructions_revision, memory_enabled)
     VALUES (?, ?, ?, ?, '', 1, 1)`
  ).run(id, "Default", now, provider.defaultModelId);

  return listProfiles();
}

export function createProfile(input: { name: string; defaultModelId?: string }) {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Profile name is required.");
  }
  if (name.length > 80) {
    throw new Error("Profile name is too long.");
  }

  const { provider } = getActiveProviderConfig();
  const allowed = new Set(provider.models.map((m) => m.id));
  const defaultModelId =
    typeof input.defaultModelId === "string" && allowed.has(input.defaultModelId)
      ? input.defaultModelId
      : provider.defaultModelId;

  const db = getDb();
  const now = new Date().toISOString();
  const id = nanoid();

  db.prepare(
    `INSERT INTO profiles (id, name, created_at, default_model_id, custom_instructions, custom_instructions_revision, memory_enabled)
     VALUES (?, ?, ?, ?, '', 1, 1)`
  ).run(id, name, now, defaultModelId);

  return getProfile(id);
}

export function getProfile(id: string): Profile {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, created_at, default_model_id, custom_instructions, custom_instructions_revision, memory_enabled
       FROM profiles WHERE id = ?`
    )
    .get(id) as ProfileRow | undefined;

  if (!row) throw new Error("Profile not found.");
  return rowToProfile(row);
}

export function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, "name" | "defaultModelId" | "customInstructions" | "memoryEnabled">>
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
          const allowed = new Set(provider.models.map((m) => m.id));
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

  db.prepare(
    `UPDATE profiles
     SET name = ?, default_model_id = ?, custom_instructions = ?, custom_instructions_revision = ?, memory_enabled = ?
     WHERE id = ?`
  ).run(name, defaultModelId, customInstructions, customInstructionsRevision, memoryEnabled, id);

  return getProfile(id);
}

export function deleteProfile(id: string) {
  const db = getDb();
  // Ensure we surface a consistent "not found" error.
  getProfile(id);
  db.prepare(`DELETE FROM profiles WHERE id = ?`).run(id);
}
