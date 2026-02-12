import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { getDb } from "@/server/db";
import {
  ALLOWED_PROFILE_AVATAR_MEDIA_TYPES,
  MAX_PROFILE_AVATAR_SIZE_BYTES,
} from "@/lib/profile-avatar-constraints";

export type ProfileAvatar = {
  mediaType: string;
  sizeBytes: number;
  updatedAt: string;
  position: { x: number; y: number };
};

const DEFAULT_POSITION = { x: 50, y: 50 };
const MAX_AVATAR_SIZE_BYTES = MAX_PROFILE_AVATAR_SIZE_BYTES;
const ALLOWED_MEDIA_TYPES = new Set<string>(ALLOWED_PROFILE_AVATAR_MEDIA_TYPES);

export function getMaxProfileAvatarSizeBytes() {
  return MAX_AVATAR_SIZE_BYTES;
}

export function isAllowedProfileAvatarMediaType(mediaType: string): boolean {
  return ALLOWED_MEDIA_TYPES.has(String(mediaType ?? "").trim().toLowerCase());
}

function avatarsDir(): string {
  const fromEnv = String(process.env.REMCOCHAT_PROFILE_AVATARS_DIR ?? "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.cwd(), "data", "profile-avatars");
}

function avatarFilePath(profileId: string): string {
  return path.join(avatarsDir(), profileId);
}

async function ensureAvatarsDir() {
  await fs.mkdir(avatarsDir(), { recursive: true });
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 50;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function normalizeAvatarPosition(input: unknown): { x: number; y: number } {
  if (!input || typeof input !== "object") return { ...DEFAULT_POSITION };
  const obj = input as Record<string, unknown>;
  const x = clampPct(Number(obj.x));
  const y = clampPct(Number(obj.y));
  return { x, y };
}

function assertProfileExists(profileId: string) {
  const id = String(profileId ?? "").trim();
  if (!id) throw new Error("Missing profileId.");
  const db = getDb();
  const row = db.prepare(`SELECT id FROM profiles WHERE id = ?`).get(id) as
    | { id: string }
    | undefined;
  if (!row) throw new Error("Profile not found.");
}

export function getProfileAvatar(profileId: string): ProfileAvatar | null {
  const id = String(profileId ?? "").trim();
  if (!id) throw new Error("Missing profileId.");

  const db = getDb();
  const row = db
    .prepare(
      `SELECT avatar_media_type, avatar_size_bytes, avatar_updated_at, avatar_pos_x, avatar_pos_y
       FROM profiles
       WHERE id = ?`
    )
    .get(id) as
    | {
        avatar_media_type: string | null;
        avatar_size_bytes: number | null;
        avatar_updated_at: string | null;
        avatar_pos_x: number | null;
        avatar_pos_y: number | null;
      }
    | undefined;

  if (!row) throw new Error("Profile not found.");

  const mediaType = row.avatar_media_type ? String(row.avatar_media_type) : "";
  const updatedAt = row.avatar_updated_at ? String(row.avatar_updated_at) : "";
  if (!mediaType || !updatedAt) return null;

  return {
    mediaType,
    sizeBytes: Number(row.avatar_size_bytes ?? 0),
    updatedAt,
    position: {
      x: clampPct(Number(row.avatar_pos_x ?? DEFAULT_POSITION.x)),
      y: clampPct(Number(row.avatar_pos_y ?? DEFAULT_POSITION.y)),
    },
  };
}

export async function readProfileAvatarFile(profileId: string): Promise<{
  bytes: Buffer;
  mediaType: string;
  updatedAt: string;
}> {
  const avatar = getProfileAvatar(profileId);
  if (!avatar) throw new Error("Avatar not found.");

  const filePath = avatarFilePath(profileId);
  try {
    const bytes = await fs.readFile(filePath);
    return { bytes, mediaType: avatar.mediaType, updatedAt: avatar.updatedAt };
  } catch {
    throw new Error("Avatar not found.");
  }
}

export async function setProfileAvatar(
  profileId: string,
  input: { bytes: Buffer; mediaType: string; position?: { x: number; y: number } }
): Promise<ProfileAvatar> {
  assertProfileExists(profileId);

  const mediaType = String(input.mediaType ?? "").trim().toLowerCase();
  if (!isAllowedProfileAvatarMediaType(mediaType)) {
    throw new Error(`Unsupported avatar type: ${mediaType || "unknown"}`);
  }

  const bytes = input.bytes;
  const sizeBytes = bytes.byteLength;
  if (sizeBytes <= 0) throw new Error("Empty file.");
  if (sizeBytes > MAX_AVATAR_SIZE_BYTES) {
    throw new Error(
      `File is too large (${sizeBytes} bytes). Max is ${MAX_AVATAR_SIZE_BYTES} bytes.`
    );
  }

  const position = input.position
    ? { x: clampPct(input.position.x), y: clampPct(input.position.y) }
    : { ...DEFAULT_POSITION };

  const updatedAt = new Date().toISOString();

  await ensureAvatarsDir();
  const finalPath = avatarFilePath(profileId);
  const tmpPath = `${finalPath}.tmp-${nanoid()}`;
  await fs.writeFile(tmpPath, bytes);
  try {
    try {
      await fs.rename(tmpPath, finalPath);
    } catch {
      await fs.unlink(finalPath).catch(() => {});
      await fs.rename(tmpPath, finalPath);
    }
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  const db = getDb();
  db.prepare(
    `UPDATE profiles
     SET avatar_media_type = ?,
         avatar_size_bytes = ?,
         avatar_updated_at = ?,
         avatar_pos_x = ?,
         avatar_pos_y = ?
     WHERE id = ?`
  ).run(mediaType, sizeBytes, updatedAt, position.x, position.y, profileId);

  return getProfileAvatar(profileId) ?? {
    mediaType,
    sizeBytes,
    updatedAt,
    position,
  };
}

export function updateProfileAvatarPosition(
  profileId: string,
  position: { x: number; y: number }
): ProfileAvatar {
  const current = getProfileAvatar(profileId);
  if (!current) throw new Error("Avatar not found.");

  const next = { x: clampPct(position.x), y: clampPct(position.y) };
  const db = getDb();
  db.prepare(
    `UPDATE profiles
     SET avatar_pos_x = ?, avatar_pos_y = ?
     WHERE id = ?`
  ).run(next.x, next.y, profileId);

  return {
    ...current,
    position: next,
  };
}

export async function deleteProfileAvatar(profileId: string) {
  assertProfileExists(profileId);

  const db = getDb();
  db.prepare(
    `UPDATE profiles
     SET avatar_media_type = NULL,
         avatar_size_bytes = NULL,
         avatar_updated_at = NULL,
         avatar_pos_x = ?,
         avatar_pos_y = ?
     WHERE id = ?`
  ).run(DEFAULT_POSITION.x, DEFAULT_POSITION.y, profileId);

  await fs.unlink(avatarFilePath(profileId)).catch(() => {});
}
