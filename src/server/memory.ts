import type { MemoryItem } from "@/lib/types";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { getProfile } from "./profiles";

type MemoryRow = {
  id: string;
  profile_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

function rowToMemoryItem(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    profileId: row.profile_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProfileMemory(profileId: string): MemoryItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, profile_id, content, created_at, updated_at
       FROM profile_memory
       WHERE profile_id = ?
       ORDER BY updated_at DESC`
    )
    .all(profileId) as MemoryRow[];

  return rows.map(rowToMemoryItem);
}

export function createMemoryItem(input: {
  profileId: string;
  content: string;
}): MemoryItem {
  const profile = getProfile(input.profileId);
  const content = String(input.content ?? "").trim();
  if (!content) throw new Error("Memory content is required.");
  if (content.length > 4000) throw new Error("Memory content is too long.");

  const db = getDb();
  const id = nanoid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO profile_memory (id, profile_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, profile.id, content, now, now);

  return getMemoryItem(profile.id, id);
}

export function getMemoryItem(profileId: string, id: string): MemoryItem {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, profile_id, content, created_at, updated_at
       FROM profile_memory
       WHERE profile_id = ? AND id = ?`
    )
    .get(profileId, id) as MemoryRow | undefined;

  if (!row) throw new Error("Memory item not found.");
  return rowToMemoryItem(row);
}

export function deleteMemoryItem(profileId: string, id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM profile_memory WHERE profile_id = ? AND id = ?`).run(
    profileId,
    id
  );
}

