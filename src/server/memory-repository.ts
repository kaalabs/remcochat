import type { MemoryItem } from "@/domain/memory/types";
import { getDb } from "@/server/db";

type MemoryRow = {
  id: string;
  profile_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type MemoryRepository = {
  listProfileMemory(profileId: string): MemoryItem[];
  getMemoryItem(profileId: string, id: string): MemoryItem | null;
  createMemoryItem(input: {
    id: string;
    profileId: string;
    content: string;
    now: string;
  }): MemoryItem;
  deleteMemoryItem(profileId: string, id: string): void;
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

export function createSqliteMemoryRepository(): MemoryRepository {
  return {
    listProfileMemory(profileId) {
      const rows = getDb()
        .prepare(
          `SELECT id, profile_id, content, created_at, updated_at
           FROM profile_memory
           WHERE profile_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(profileId) as MemoryRow[];
      return rows.map(rowToMemoryItem);
    },

    getMemoryItem(profileId, id) {
      const row = getDb()
        .prepare(
          `SELECT id, profile_id, content, created_at, updated_at
           FROM profile_memory
           WHERE profile_id = ? AND id = ?`,
        )
        .get(profileId, id) as MemoryRow | undefined;
      return row ? rowToMemoryItem(row) : null;
    },

    createMemoryItem(input) {
      getDb()
        .prepare(
          `INSERT INTO profile_memory (id, profile_id, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.id, input.profileId, input.content, input.now, input.now);
      return this.getMemoryItem(input.profileId, input.id)!;
    },

    deleteMemoryItem(profileId, id) {
      getDb()
        .prepare(`DELETE FROM profile_memory WHERE profile_id = ? AND id = ?`)
        .run(profileId, id);
    },
  };
}

export const sqliteMemoryRepository = createSqliteMemoryRepository();
