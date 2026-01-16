import { getDb } from "./db";

export type PendingMemory = {
  chatId: string;
  profileId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type PendingMemoryRow = {
  chat_id: string;
  profile_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

function rowToPendingMemory(row: PendingMemoryRow): PendingMemory {
  return {
    chatId: row.chat_id,
    profileId: row.profile_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPendingMemory(chatId: string): PendingMemory | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT chat_id, profile_id, content, created_at, updated_at
       FROM pending_memory
       WHERE chat_id = ?`
    )
    .get(chatId) as PendingMemoryRow | undefined;

  if (!row) return null;
  return rowToPendingMemory(row);
}

export function upsertPendingMemory(input: {
  chatId: string;
  profileId: string;
  content: string;
}): PendingMemory {
  const content = String(input.content ?? "").trim();
  if (!content) throw new Error("Pending memory content is required.");
  if (content.length > 4000) throw new Error("Memory content is too long.");

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO pending_memory (chat_id, profile_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       profile_id = excluded.profile_id,
       content = excluded.content,
       updated_at = excluded.updated_at`
  ).run(input.chatId, input.profileId, content, now, now);

  return getPendingMemory(input.chatId)!;
}

export function clearPendingMemory(chatId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM pending_memory WHERE chat_id = ?`).run(chatId);
}
