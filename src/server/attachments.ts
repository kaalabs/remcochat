import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { getDb } from "@/server/db";
import { getConfig } from "@/server/config";
export { makeAttachmentUrl, parseAttachmentUrl } from "@/lib/attachment-url";

export type StoredAttachment = {
  id: string;
  profileId: string;
  chatId: string | null;
  temporarySessionId: string | null;
  messageId: string | null;
  originalFilename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  deletedAt: string | null;
  expiresAt: string | null;
};

type AttachmentRow = {
  id: string;
  profile_id: string;
  chat_id: string | null;
  temporary_session_id: string | null;
  message_id: string | null;
  original_filename: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  deleted_at: string | null;
  expires_at: string | null;
};

function rowToStoredAttachment(row: AttachmentRow): StoredAttachment {
  return {
    id: row.id,
    profileId: row.profile_id,
    chatId: row.chat_id,
    temporarySessionId: row.temporary_session_id,
    messageId: row.message_id,
    originalFilename: row.original_filename,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: row.sha256,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at,
  };
}

function attachmentsDir(): string {
  const fromEnv = String(process.env.REMCOCHAT_ATTACHMENTS_DIR ?? "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.cwd(), "data", "attachments");
}

function attachmentFilePath(attachmentId: string): string {
  return path.join(attachmentsDir(), attachmentId);
}

async function ensureAttachmentsDir() {
  await fs.mkdir(attachmentsDir(), { recursive: true });
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function isAllowedAttachmentMediaType(mediaType: string): boolean {
  const cfg = getConfig().attachments;
  const normalized = String(mediaType ?? "").trim().toLowerCase();
  return cfg.allowedMediaTypes.some((t) => t.toLowerCase() === normalized);
}

export function sanitizeFilenameForContentDisposition(input: string): string {
  const trimmed = String(input ?? "").trim() || "attachment";
  return trimmed
    .replace(/[^\w\s.-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "attachment";
}

let lastPurgeAt = 0;
async function purgeExpiredAttachmentsIfNeeded() {
  const now = Date.now();
  if (now - lastPurgeAt < 60_000) return;
  lastPurgeAt = now;
  await purgeExpiredAttachments();
}

export async function purgeExpiredAttachments(): Promise<number> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const rows = db
    .prepare(
      `SELECT id
       FROM attachments
       WHERE deleted_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at <= ?`
    )
    .all(nowIso) as Array<{ id: string }>;

  if (rows.length === 0) return 0;

  const tx = db.transaction((ids: string[]) => {
    const stmt = db.prepare(`UPDATE attachments SET deleted_at = ? WHERE id = ?`);
    for (const id of ids) {
      stmt.run(nowIso, id);
    }
  });
  tx(rows.map((r) => r.id));

  await ensureAttachmentsDir();
  await Promise.all(
    rows.map(async ({ id }) => {
      try {
        await fs.unlink(attachmentFilePath(id));
      } catch {
        // ignore
      }
    })
  );

  return rows.length;
}

export async function storeAttachment(input: {
  profileId: string;
  chatId: string | null;
  temporarySessionId: string | null;
  originalFilename: string;
  mediaType: string;
  bytes: Buffer;
}): Promise<StoredAttachment> {
  const cfg = getConfig().attachments;
  if (!cfg.enabled) throw new Error("Attachments are disabled.");

  const profileId = String(input.profileId ?? "").trim();
  if (!profileId) throw new Error("Missing profileId.");

  const chatIdRaw = String(input.chatId ?? "").trim();
  const chatId = chatIdRaw ? chatIdRaw : null;
  const tmpRaw = String(input.temporarySessionId ?? "").trim();
  const temporarySessionId = tmpRaw ? tmpRaw : null;
  if (!chatId && !temporarySessionId) {
    throw new Error("Missing chatId or temporarySessionId.");
  }

  const originalFilename = String(input.originalFilename ?? "").trim() || "attachment";
  const mediaType = String(input.mediaType ?? "").trim() || "application/octet-stream";

  if (!isAllowedAttachmentMediaType(mediaType)) {
    throw new Error(`Unsupported attachment type: ${mediaType}`);
  }

  const bytes = input.bytes;
  const sizeBytes = bytes.byteLength;
  if (sizeBytes <= 0) throw new Error("Empty file.");
  if (sizeBytes > cfg.maxFileSizeBytes) {
    throw new Error(
      `File is too large (${sizeBytes} bytes). Max is ${cfg.maxFileSizeBytes} bytes.`
    );
  }

  await purgeExpiredAttachmentsIfNeeded();

  const id = nanoid();
  const sha256 = sha256Hex(bytes);
  const createdAt = new Date().toISOString();
  const expiresAt =
    temporarySessionId != null
      ? new Date(Date.now() + cfg.temporaryTtlMs).toISOString()
      : null;

  const db = getDb();
  db.prepare(
    `INSERT INTO attachments (
       id, profile_id, chat_id, temporary_session_id, message_id,
       original_filename, media_type, size_bytes, sha256,
       created_at, deleted_at, expires_at
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    id,
    profileId,
    chatId,
    temporarySessionId,
    originalFilename,
    mediaType,
    sizeBytes,
    sha256,
    createdAt,
    expiresAt
  );

  try {
    await ensureAttachmentsDir();
    await fs.writeFile(attachmentFilePath(id), bytes);
  } catch (err) {
    try {
      db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);
    } catch {
      // ignore
    }
    throw err;
  }

  const row = db
    .prepare(`SELECT * FROM attachments WHERE id = ?`)
    .get(id) as AttachmentRow | undefined;
  if (!row) throw new Error("Failed to persist attachment.");
  return rowToStoredAttachment(row);
}

export function getAttachmentForProfile(input: {
  profileId: string;
  attachmentId: string;
}): StoredAttachment {
  const profileId = String(input.profileId ?? "").trim();
  const attachmentId = String(input.attachmentId ?? "").trim();
  if (!profileId) throw new Error("Missing profileId.");
  if (!attachmentId) throw new Error("Missing attachmentId.");

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM attachments WHERE id = ?`)
    .get(attachmentId) as AttachmentRow | undefined;
  if (!row) throw new Error("Attachment not found.");
  if (row.profile_id !== profileId) throw new Error("Attachment not found.");
  if (row.deleted_at) throw new Error("Attachment not found.");

  if (row.expires_at) {
    const expiresAt = Date.parse(row.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      throw new Error("Attachment not found.");
    }
  }

  return rowToStoredAttachment(row);
}

export async function readAttachmentBytes(attachmentId: string): Promise<Buffer> {
  const filePath = attachmentFilePath(attachmentId);
  return await fs.readFile(filePath);
}

export function bindAttachmentToMessage(input: {
  profileId: string;
  attachmentId: string;
  messageId: string;
}) {
  const profileId = String(input.profileId ?? "").trim();
  const attachmentId = String(input.attachmentId ?? "").trim();
  const messageId = String(input.messageId ?? "").trim();
  if (!profileId) throw new Error("Missing profileId.");
  if (!attachmentId) throw new Error("Missing attachmentId.");
  if (!messageId) throw new Error("Missing messageId.");

  const db = getDb();
  db.prepare(
    `UPDATE attachments
     SET message_id = COALESCE(message_id, ?)
     WHERE id = ? AND profile_id = ?`
  ).run(messageId, attachmentId, profileId);
}

export async function deleteAttachmentsForChat(input: {
  profileId: string;
  chatId: string;
}) {
  const profileId = String(input.profileId ?? "").trim();
  const chatId = String(input.chatId ?? "").trim();
  if (!profileId) throw new Error("Missing profileId.");
  if (!chatId) throw new Error("Missing chatId.");

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id
       FROM attachments
       WHERE profile_id = ? AND chat_id = ? AND deleted_at IS NULL`
    )
    .all(profileId, chatId) as Array<{ id: string }>;

  if (rows.length === 0) return;

  const now = new Date().toISOString();
  const tx = db.transaction((ids: string[]) => {
    const stmt = db.prepare(`UPDATE attachments SET deleted_at = ? WHERE id = ?`);
    for (const id of ids) {
      stmt.run(now, id);
    }
  });
  tx(rows.map((r) => r.id));

  await ensureAttachmentsDir();
  await Promise.all(
    rows.map(async ({ id }) => {
      try {
        await fs.unlink(attachmentFilePath(id));
      } catch {
        // ignore
      }
    })
  );
}

export async function deleteAttachmentsForProfile(profileId: string) {
  const id = String(profileId ?? "").trim();
  if (!id) throw new Error("Missing profileId.");

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id
       FROM attachments
       WHERE profile_id = ? AND deleted_at IS NULL`
    )
    .all(id) as Array<{ id: string }>;

  if (rows.length === 0) return;

  const now = new Date().toISOString();
  const tx = db.transaction((ids: string[]) => {
    const stmt = db.prepare(`UPDATE attachments SET deleted_at = ? WHERE id = ?`);
    for (const attachmentId of ids) {
      stmt.run(now, attachmentId);
    }
  });
  tx(rows.map((r) => r.id));

  await ensureAttachmentsDir();
  await Promise.all(
    rows.map(async ({ id }) => {
      try {
        await fs.unlink(attachmentFilePath(id));
      } catch {
        // ignore
      }
    })
  );
}
