import { getDb } from "@/server/db";
import type {
  TaskList,
  TaskListItem,
  TaskListKind,
  TaskListOverview,
} from "@/domain/lists/types";
import {
  buildTaskListStats,
  normalizeListName,
} from "@/server/lists-domain";

type ListRow = {
  id: string;
  profile_id: string;
  name: string;
  kind: TaskListKind;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  list_id: string;
  content: string;
  completed: number;
  created_at: string;
  updated_at: string;
  position: number;
};

type ProfileLookupRow = {
  id: string;
  name: string;
};

type ListOverviewRow = {
  id: string;
  profile_id: string;
  name: string;
  kind: TaskListKind;
  updated_at: string;
  owner_name: string;
};

export type StoredTaskListRecord = {
  id: string;
  profileId: string;
  name: string;
  kind: TaskListKind;
  createdAt: string;
  updatedAt: string;
};

export type StoredProfileLookup = {
  id: string;
  name: string;
};

export type ListsRepository = {
  findProfilesByIdentifier(identifier: string): StoredProfileLookup[];
  getAccessibleListRecordById(profileId: string, listId: string): StoredTaskListRecord | null;
  getOwnedListRecordByName(profileId: string, name: string): StoredTaskListRecord | null;
  findAccessibleListRecordsByName(input: {
    profileId: string;
    name: string;
    ownerProfileId?: string;
  }): StoredTaskListRecord[];
  createOwnedListRecord(input: {
    id: string;
    profileId: string;
    name: string;
    kind: TaskListKind;
    now: string;
  }): StoredTaskListRecord;
  listListItems(listId: string): TaskListItem[];
  countListShares(listId: string): number;
  hydrateTaskList(record: StoredTaskListRecord): TaskList;
  touchList(listId: string, updatedAt: string): void;
  countListItems(listId: string): number;
  getMaxListItemPosition(listId: string): number;
  insertListItem(input: {
    id: string;
    listId: string;
    content: string;
    completed: boolean;
    createdAt: string;
    updatedAt: string;
    position: number;
  }): void;
  getListItemCompletion(listId: string, itemId: string): boolean | null;
  updateListItemCompletion(input: { itemId: string; completed: boolean; updatedAt: string }): void;
  deleteListItem(listId: string, itemId: string): void;
  deleteCompletedItems(listId: string): void;
  renameOwnedList(input: { listId: string; name: string; updatedAt: string }): void;
  deleteOwnedList(listId: string, profileId: string): void;
  addListMember(input: { listId: string; profileId: string; createdAt: string }): void;
  removeListMember(listId: string, profileId: string): void;
  listAccessibleTaskListRecords(profileId: string): StoredTaskListRecord[];
  listAccessibleTaskListOverviews(profileId: string): TaskListOverview[];
};

function rowToListRecord(row: ListRow): StoredTaskListRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTaskListItem(row: ItemRow): TaskListItem {
  return {
    id: row.id,
    listId: row.list_id,
    content: row.content,
    completed: Boolean(row.completed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    position: row.position,
  };
}

export function createSqliteListsRepository(): ListsRepository {
  return {
    findProfilesByIdentifier(identifier) {
      const trimmed = normalizeListName(String(identifier ?? ""));
      if (!trimmed) return [];
      const db = getDb();
      const byId = db
        .prepare(`SELECT id, name FROM profiles WHERE id = ?`)
        .get(trimmed) as ProfileLookupRow | undefined;
      if (byId) return [{ id: byId.id, name: byId.name }];
      const rows = db
        .prepare(`SELECT id, name FROM profiles WHERE lower(name) = lower(?)`)
        .all(trimmed) as ProfileLookupRow[];
      return rows.map((row) => ({ id: row.id, name: row.name }));
    },

    getAccessibleListRecordById(profileId, listId) {
      const db = getDb();
      const row = db
        .prepare(
          `
            SELECT id, profile_id, name, kind, created_at, updated_at
            FROM lists
            WHERE id = ?
              AND (
                profile_id = ?
                OR EXISTS (
                  SELECT 1 FROM list_members
                  WHERE list_members.list_id = lists.id
                    AND list_members.profile_id = ?
                )
              )
          `,
        )
        .get(listId, profileId, profileId) as ListRow | undefined;
      return row ? rowToListRecord(row) : null;
    },

    getOwnedListRecordByName(profileId, name) {
      const normalizedName = normalizeListName(name);
      if (!normalizedName) return null;
      const db = getDb();
      const row = db
        .prepare(
          `
            SELECT id, profile_id, name, kind, created_at, updated_at
            FROM lists
            WHERE profile_id = ? AND lower(name) = lower(?)
          `,
        )
        .get(profileId, normalizedName) as ListRow | undefined;
      return row ? rowToListRecord(row) : null;
    },

    findAccessibleListRecordsByName(input) {
      const name = normalizeListName(input.name);
      if (!name) return [];
      const db = getDb();
      const params: Array<string> = [name, input.profileId, input.profileId];
      const ownerFilter = input.ownerProfileId ? "AND lists.profile_id = ?" : "";
      if (input.ownerProfileId) {
        params.push(input.ownerProfileId);
      }
      const rows = db
        .prepare(
          `
            SELECT
              lists.id as id,
              lists.profile_id as profile_id,
              lists.name as name,
              lists.kind as kind,
              lists.created_at as created_at,
              lists.updated_at as updated_at
            FROM lists
            WHERE lower(name) = lower(?)
              AND (
                profile_id = ?
                OR EXISTS (
                  SELECT 1 FROM list_members
                  WHERE list_members.list_id = lists.id
                    AND list_members.profile_id = ?
                )
              )
              ${ownerFilter}
            ORDER BY updated_at DESC
          `,
        )
        .all(...params) as ListRow[];
      return rows.map(rowToListRecord);
    },

    createOwnedListRecord(input) {
      const db = getDb();
      db.prepare(
        `
          INSERT INTO lists (id, profile_id, name, kind, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(input.id, input.profileId, input.name, input.kind, input.now, input.now);
      return this.getAccessibleListRecordById(input.profileId, input.id)!;
    },

    listListItems(listId) {
      const db = getDb();
      const rows = db
        .prepare(
          `
            SELECT id, list_id, content, completed, created_at, updated_at, position
            FROM list_items
            WHERE list_id = ?
            ORDER BY completed ASC, position ASC, created_at ASC
          `,
        )
        .all(listId) as ItemRow[];
      return rows.map(rowToTaskListItem);
    },

    countListShares(listId) {
      const db = getDb();
      const row = db
        .prepare(`SELECT COUNT(1) as count FROM list_members WHERE list_id = ?`)
        .get(listId) as { count?: number } | undefined;
      return row?.count ?? 0;
    },

    hydrateTaskList(record) {
      const items = this.listListItems(record.id);
      return {
        id: record.id,
        profileId: record.profileId,
        name: record.name,
        kind: record.kind,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        items,
        sharedCount: this.countListShares(record.id),
        deleted: false,
        stats: buildTaskListStats(items),
      };
    },

    touchList(listId, updatedAt) {
      const db = getDb();
      db.prepare(`UPDATE lists SET updated_at = ? WHERE id = ?`).run(updatedAt, listId);
    },

    countListItems(listId) {
      const db = getDb();
      const row = db
        .prepare(`SELECT COUNT(1) as count FROM list_items WHERE list_id = ?`)
        .get(listId) as { count?: number } | undefined;
      return row?.count ?? 0;
    },

    getMaxListItemPosition(listId) {
      const db = getDb();
      const row = db
        .prepare(
          `SELECT COALESCE(MAX(position), 0) as max_position FROM list_items WHERE list_id = ?`,
        )
        .get(listId) as { max_position?: number } | undefined;
      return row?.max_position ?? 0;
    },

    insertListItem(input) {
      const db = getDb();
      db.prepare(
        `
          INSERT INTO list_items
            (id, list_id, content, completed, created_at, updated_at, position)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        input.id,
        input.listId,
        input.content,
        input.completed ? 1 : 0,
        input.createdAt,
        input.updatedAt,
        input.position,
      );
    },

    getListItemCompletion(listId, itemId) {
      const db = getDb();
      const row = db
        .prepare(`SELECT completed FROM list_items WHERE id = ? AND list_id = ?`)
        .get(itemId, listId) as { completed?: number } | undefined;
      if (!row) return null;
      return Boolean(row.completed);
    },

    updateListItemCompletion(input) {
      const db = getDb();
      db.prepare(`UPDATE list_items SET completed = ?, updated_at = ? WHERE id = ?`).run(
        input.completed ? 1 : 0,
        input.updatedAt,
        input.itemId,
      );
    },

    deleteListItem(listId, itemId) {
      const db = getDb();
      db.prepare(`DELETE FROM list_items WHERE id = ? AND list_id = ?`).run(itemId, listId);
    },

    deleteCompletedItems(listId) {
      const db = getDb();
      db.prepare(`DELETE FROM list_items WHERE list_id = ? AND completed = 1`).run(listId);
    },

    renameOwnedList(input) {
      const db = getDb();
      db.prepare(`UPDATE lists SET name = ?, updated_at = ? WHERE id = ?`).run(
        input.name,
        input.updatedAt,
        input.listId,
      );
    },

    deleteOwnedList(listId, profileId) {
      const db = getDb();
      db.prepare(`DELETE FROM lists WHERE id = ? AND profile_id = ?`).run(listId, profileId);
    },

    addListMember(input) {
      const db = getDb();
      db.prepare(
        `
          INSERT OR IGNORE INTO list_members (list_id, profile_id, created_at)
          VALUES (?, ?, ?)
        `,
      ).run(input.listId, input.profileId, input.createdAt);
    },

    removeListMember(listId, profileId) {
      const db = getDb();
      db.prepare(`DELETE FROM list_members WHERE list_id = ? AND profile_id = ?`).run(
        listId,
        profileId,
      );
    },

    listAccessibleTaskListRecords(profileId) {
      const db = getDb();
      const rows = db
        .prepare(
          `
            SELECT
              lists.id as id,
              lists.profile_id as profile_id,
              lists.name as name,
              lists.kind as kind,
              lists.created_at as created_at,
              lists.updated_at as updated_at
            FROM lists
            LEFT JOIN list_members
              ON list_members.list_id = lists.id
             AND list_members.profile_id = ?
            WHERE lists.profile_id = ?
               OR list_members.profile_id = ?
            ORDER BY updated_at DESC
          `,
        )
        .all(profileId, profileId, profileId) as ListRow[];
      return rows.map(rowToListRecord);
    },

    listAccessibleTaskListOverviews(profileId) {
      const db = getDb();
      const rows = db
        .prepare(
          `
            SELECT
              lists.id as id,
              lists.profile_id as profile_id,
              lists.name as name,
              lists.kind as kind,
              lists.updated_at as updated_at,
              profiles.name as owner_name
            FROM lists
            LEFT JOIN list_members
              ON list_members.list_id = lists.id
             AND list_members.profile_id = ?
            JOIN profiles
              ON profiles.id = lists.profile_id
            WHERE lists.profile_id = ?
               OR list_members.profile_id = ?
            ORDER BY lists.updated_at DESC
          `,
        )
        .all(profileId, profileId, profileId) as ListOverviewRow[];

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        ownerProfileId: row.profile_id,
        ownerProfileName: row.owner_name,
        updatedAt: row.updated_at,
        scope: row.profile_id === profileId ? "owned" : "shared",
      }));
    },
  };
}

export const sqliteListsRepository = createSqliteListsRepository();
