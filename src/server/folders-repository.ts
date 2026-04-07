import { getDb } from "@/server/db";
import { normalizeFolderSpaces } from "@/server/folders-domain";

type ProfileLookupRow = {
  id: string;
  name: string;
};

type ChatFolderRow = {
  id: string;
  profile_id: string;
  name: string;
  collapsed: number;
  created_at: string;
  updated_at: string;
};

type FolderMemberRow = {
  folder_id: string;
  profile_id: string;
  collapsed: number;
  created_at: string;
};

type FolderMemberWithProfileRow = {
  profile_id: string;
  name: string;
  created_at: string;
};

type AccessibleFolderRow = ChatFolderRow & {
  owner_name: string;
  shared_with_count?: number;
};

type SharedFolderRow = {
  id: string;
  profile_id: string;
  name: string;
  collapsed: number;
  created_at: string;
  updated_at: string;
  owner_name: string;
};

export type StoredProfileLookup = {
  id: string;
  name: string;
};

export type StoredChatFolderRecord = {
  id: string;
  profileId: string;
  name: string;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoredFolderMembershipRecord = {
  folderId: string;
  profileId: string;
  collapsed: boolean;
  createdAt: string;
};

export type StoredAccessibleFolderRecord = StoredChatFolderRecord & {
  scope: "owned" | "shared";
  ownerName: string;
  sharedWithCount: number;
};

export type StoredFolderMemberProfileRecord = {
  profileId: string;
  name: string;
  createdAt: string;
};

export type FoldersRepository = {
  findProfilesByIdentifier(identifier: string): StoredProfileLookup[];
  getOwnedFolderRecord(profileId: string, folderId: string): StoredChatFolderRecord | null;
  getFolderRecordById(folderId: string): StoredChatFolderRecord | null;
  getFolderMembershipRecord(
    folderId: string,
    profileId: string,
  ): StoredFolderMembershipRecord | null;
  folderNameExists(profileId: string, name: string, excludeFolderId?: string): boolean;
  listOwnedFolderRecords(profileId: string): StoredChatFolderRecord[];
  listAccessibleFolderRecords(profileId: string): StoredAccessibleFolderRecord[];
  createOwnedFolderRecord(input: {
    id: string;
    profileId: string;
    name: string;
    collapsed: boolean;
    now: string;
  }): StoredChatFolderRecord;
  updateOwnedFolderRecord(input: {
    profileId: string;
    folderId: string;
    name: string;
    collapsed: boolean;
    updatedAt: string;
  }): StoredChatFolderRecord;
  updateFolderMembershipCollapsed(input: {
    folderId: string;
    profileId: string;
    collapsed: boolean;
  }): void;
  deleteOwnedFolderAndDetachChats(profileId: string, folderId: string): void;
  addFolderMember(input: {
    folderId: string;
    profileId: string;
    collapsed: boolean;
    createdAt: string;
  }): void;
  removeFolderMember(folderId: string, profileId: string): void;
  listFolderMemberProfiles(folderId: string): StoredFolderMemberProfileRecord[];
};

function rowToFolderRecord(row: ChatFolderRow): StoredChatFolderRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    collapsed: Boolean(row.collapsed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMembershipRecord(row: FolderMemberRow): StoredFolderMembershipRecord {
  return {
    folderId: row.folder_id,
    profileId: row.profile_id,
    collapsed: Boolean(row.collapsed),
    createdAt: row.created_at,
  };
}

export function createSqliteFoldersRepository(): FoldersRepository {
  return {
    findProfilesByIdentifier(identifier) {
      const trimmed = normalizeFolderSpaces(String(identifier ?? ""));
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

    getOwnedFolderRecord(profileId, folderId) {
      const row = getDb()
        .prepare(
          `
            SELECT id, profile_id, name, collapsed, created_at, updated_at
            FROM chat_folders
            WHERE id = ? AND profile_id = ?
          `,
        )
        .get(folderId, profileId) as ChatFolderRow | undefined;
      return row ? rowToFolderRecord(row) : null;
    },

    getFolderRecordById(folderId) {
      const row = getDb()
        .prepare(
          `
            SELECT id, profile_id, name, collapsed, created_at, updated_at
            FROM chat_folders
            WHERE id = ?
          `,
        )
        .get(folderId) as ChatFolderRow | undefined;
      return row ? rowToFolderRecord(row) : null;
    },

    getFolderMembershipRecord(folderId, profileId) {
      const row = getDb()
        .prepare(
          `
            SELECT folder_id, profile_id, collapsed, created_at
            FROM chat_folder_members
            WHERE folder_id = ? AND profile_id = ?
          `,
        )
        .get(folderId, profileId) as FolderMemberRow | undefined;
      return row ? rowToMembershipRecord(row) : null;
    },

    folderNameExists(profileId, name, excludeFolderId) {
      const row = getDb()
        .prepare(
          `
            SELECT id
            FROM chat_folders
            WHERE profile_id = ?
              AND name = ? COLLATE NOCASE
              AND (? IS NULL OR id != ?)
            LIMIT 1
          `,
        )
        .get(profileId, name, excludeFolderId ?? null, excludeFolderId ?? null) as
        | { id: string }
        | undefined;
      return Boolean(row);
    },

    listOwnedFolderRecords(profileId) {
      const rows = getDb()
        .prepare(
          `
            SELECT id, profile_id, name, collapsed, created_at, updated_at
            FROM chat_folders
            WHERE profile_id = ?
            ORDER BY created_at ASC
          `,
        )
        .all(profileId) as ChatFolderRow[];
      return rows.map(rowToFolderRecord);
    },

    listAccessibleFolderRecords(profileId) {
      const db = getDb();
      const ownedRows = db
        .prepare(
          `
            SELECT
              chat_folders.id as id,
              chat_folders.profile_id as profile_id,
              chat_folders.name as name,
              chat_folders.collapsed as collapsed,
              chat_folders.created_at as created_at,
              chat_folders.updated_at as updated_at,
              profiles.name as owner_name,
              (
                SELECT COUNT(1)
                FROM chat_folder_members
                WHERE chat_folder_members.folder_id = chat_folders.id
              ) as shared_with_count
            FROM chat_folders
            JOIN profiles ON profiles.id = chat_folders.profile_id
            WHERE chat_folders.profile_id = ?
            ORDER BY chat_folders.created_at ASC
          `,
        )
        .all(profileId) as AccessibleFolderRow[];

      const sharedRows = db
        .prepare(
          `
            SELECT
              chat_folders.id as id,
              chat_folders.profile_id as profile_id,
              chat_folders.name as name,
              chat_folder_members.collapsed as collapsed,
              chat_folders.created_at as created_at,
              chat_folders.updated_at as updated_at,
              profiles.name as owner_name
            FROM chat_folders
            JOIN chat_folder_members
              ON chat_folder_members.folder_id = chat_folders.id
             AND chat_folder_members.profile_id = ?
            JOIN profiles ON profiles.id = chat_folders.profile_id
            WHERE chat_folders.profile_id != ?
            ORDER BY lower(profiles.name) ASC, chat_folders.created_at ASC
          `,
        )
        .all(profileId, profileId) as SharedFolderRow[];

      const owned = ownedRows.map(
        (row): StoredAccessibleFolderRecord => ({
          ...rowToFolderRecord(row),
          scope: "owned",
          ownerName: row.owner_name,
          sharedWithCount: Number(row.shared_with_count ?? 0),
        }),
      );
      const shared = sharedRows.map(
        (row): StoredAccessibleFolderRecord => ({
          ...rowToFolderRecord(row),
          scope: "shared",
          ownerName: row.owner_name,
          sharedWithCount: 0,
        }),
      );
      return owned.concat(shared);
    },

    createOwnedFolderRecord(input) {
      getDb()
        .prepare(
          `
            INSERT INTO chat_folders (id, profile_id, name, collapsed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          input.id,
          input.profileId,
          input.name,
          input.collapsed ? 1 : 0,
          input.now,
          input.now,
        );
      return this.getOwnedFolderRecord(input.profileId, input.id)!;
    },

    updateOwnedFolderRecord(input) {
      getDb()
        .prepare(
          `
            UPDATE chat_folders
            SET name = ?, collapsed = ?, updated_at = ?
            WHERE id = ? AND profile_id = ?
          `,
        )
        .run(
          input.name,
          input.collapsed ? 1 : 0,
          input.updatedAt,
          input.folderId,
          input.profileId,
        );
      return this.getOwnedFolderRecord(input.profileId, input.folderId)!;
    },

    updateFolderMembershipCollapsed(input) {
      getDb()
        .prepare(
          `
            UPDATE chat_folder_members
            SET collapsed = ?
            WHERE folder_id = ? AND profile_id = ?
          `,
        )
        .run(input.collapsed ? 1 : 0, input.folderId, input.profileId);
    },

    deleteOwnedFolderAndDetachChats(profileId, folderId) {
      const db = getDb();
      const tx = db.transaction(() => {
        db.prepare(
          `
            UPDATE chats
            SET folder_id = NULL
            WHERE profile_id = ? AND folder_id = ?
          `,
        ).run(profileId, folderId);
        db.prepare(`DELETE FROM chat_folders WHERE id = ? AND profile_id = ?`).run(
          folderId,
          profileId,
        );
      });
      tx();
    },

    addFolderMember(input) {
      getDb()
        .prepare(
          `
            INSERT OR IGNORE INTO chat_folder_members (folder_id, profile_id, collapsed, created_at)
            VALUES (?, ?, ?, ?)
          `,
        )
        .run(
          input.folderId,
          input.profileId,
          input.collapsed ? 1 : 0,
          input.createdAt,
        );
    },

    removeFolderMember(folderId, profileId) {
      getDb()
        .prepare(`DELETE FROM chat_folder_members WHERE folder_id = ? AND profile_id = ?`)
        .run(folderId, profileId);
    },

    listFolderMemberProfiles(folderId) {
      const rows = getDb()
        .prepare(
          `
            SELECT
              chat_folder_members.profile_id as profile_id,
              profiles.name as name,
              chat_folder_members.created_at as created_at
            FROM chat_folder_members
            JOIN profiles ON profiles.id = chat_folder_members.profile_id
            WHERE chat_folder_members.folder_id = ?
            ORDER BY lower(profiles.name) ASC, chat_folder_members.created_at ASC
          `,
        )
        .all(folderId) as FolderMemberWithProfileRow[];
      return rows.map((row) => ({
        profileId: row.profile_id,
        name: row.name,
        createdAt: row.created_at,
      }));
    },
  };
}

export const sqliteFoldersRepository = createSqliteFoldersRepository();
