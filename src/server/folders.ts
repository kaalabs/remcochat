import { nanoid } from "nanoid";
import { getDb } from "@/server/db";

const MAX_FOLDER_NAME_LENGTH = 60;

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

function normalizeSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function ensureFolderName(name: string) {
  const trimmed = normalizeSpaces(String(name ?? ""));
  if (!trimmed) {
    throw new Error("Folder name is required.");
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new Error("Folder name is too long.");
  }
  return trimmed;
}

function rowToFolder(row: ChatFolderRow) {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    collapsed: Boolean(row.collapsed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findProfilesByIdentifier(identifier: string): ProfileLookupRow[] {
  const trimmed = normalizeSpaces(String(identifier ?? ""));
  if (!trimmed) return [];
  const db = getDb();
  const byId = db
    .prepare(`SELECT id, name FROM profiles WHERE id = ?`)
    .get(trimmed) as ProfileLookupRow | undefined;
  if (byId) return [byId];
  return db
    .prepare(`SELECT id, name FROM profiles WHERE lower(name) = lower(?)`)
    .all(trimmed) as ProfileLookupRow[];
}

function resolveProfileIdentifier(identifier: string): ProfileLookupRow {
  const matches = findProfilesByIdentifier(identifier);
  if (matches.length === 0) {
    throw new Error("Profile not found.");
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple profiles are named "${identifier}". Rename one to share folders.`
    );
  }
  return matches[0];
}

function getFolderRow(profileId: string, folderId: string): ChatFolderRow {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, profile_id, name, collapsed, created_at, updated_at
        FROM chat_folders
        WHERE id = ? AND profile_id = ?
      `
    )
    .get(folderId, profileId) as ChatFolderRow | undefined;
  if (!row) throw new Error("Folder not found.");
  return row;
}

function getFolderRowById(folderId: string): ChatFolderRow {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, profile_id, name, collapsed, created_at, updated_at
        FROM chat_folders
        WHERE id = ?
      `
    )
    .get(folderId) as ChatFolderRow | undefined;
  if (!row) throw new Error("Folder not found.");
  return row;
}

function getFolderMemberRow(folderId: string, profileId: string): FolderMemberRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT folder_id, profile_id, collapsed, created_at
        FROM chat_folder_members
        WHERE folder_id = ? AND profile_id = ?
      `
    )
    .get(folderId, profileId) as FolderMemberRow | undefined;
  return row ?? null;
}

function folderNameExists(profileId: string, name: string, excludeFolderId?: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id
        FROM chat_folders
        WHERE profile_id = ?
          AND name = ? COLLATE NOCASE
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `
    )
    .get(profileId, name, excludeFolderId ?? null, excludeFolderId ?? null) as
    | { id: string }
    | undefined;
  return Boolean(row);
}

export function listFolders(profileId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id, profile_id, name, collapsed, created_at, updated_at
        FROM chat_folders
        WHERE profile_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(profileId) as ChatFolderRow[];
  return rows.map(rowToFolder);
}

export function listAccessibleFolders(profileId: string) {
  const db = getDb();

  type AccessibleFolder = ReturnType<typeof rowToFolder> & {
    scope: "owned" | "shared";
    ownerName: string;
    sharedWithCount: number;
  };

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
      `
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
      `
    )
    .all(profileId, profileId) as SharedFolderRow[];

  const owned: AccessibleFolder[] = ownedRows.map((row) => ({
    ...rowToFolder(row),
    scope: "owned",
    ownerName: row.owner_name,
    sharedWithCount: Number(row.shared_with_count ?? 0),
  }));

  const shared: AccessibleFolder[] = sharedRows.map((row) => ({
    ...rowToFolder(row),
    scope: "shared",
    ownerName: row.owner_name,
    sharedWithCount: 0,
  }));

  return owned.concat(shared);
}

export function createFolder(profileId: string, input: { name: string }) {
  const db = getDb();
  const name = ensureFolderName(input.name);

  if (folderNameExists(profileId, name)) {
    throw new Error("Folder name already exists.");
  }

  const now = new Date().toISOString();
  const row: ChatFolderRow = {
    id: nanoid(),
    profile_id: profileId,
    name,
    collapsed: 0,
    created_at: now,
    updated_at: now,
  };

  try {
    db.prepare(
      `
        INSERT INTO chat_folders (id, profile_id, name, collapsed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.id,
      row.profile_id,
      row.name,
      row.collapsed,
      row.created_at,
      row.updated_at
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.toLowerCase().includes("idx_chat_folders_profile_name")) {
      throw new Error("Folder name already exists.");
    }
    throw err;
  }

  return rowToFolder(row);
}

export function updateFolder(
  profileId: string,
  folderId: string,
  input: { name?: string; collapsed?: boolean }
) {
  const existing = getFolderRow(profileId, folderId);
  const name =
    input.name === undefined ? existing.name : ensureFolderName(input.name);
  const collapsed =
    input.collapsed === undefined ? existing.collapsed : input.collapsed ? 1 : 0;

  if (name !== existing.name && folderNameExists(profileId, name, folderId)) {
    throw new Error("Folder name already exists.");
  }

  const now = new Date().toISOString();
  const db = getDb();

  try {
    db.prepare(
      `
        UPDATE chat_folders
        SET name = ?, collapsed = ?, updated_at = ?
        WHERE id = ? AND profile_id = ?
      `
    ).run(name, collapsed, now, folderId, profileId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.toLowerCase().includes("idx_chat_folders_profile_name")) {
      throw new Error("Folder name already exists.");
    }
    throw err;
  }

  return rowToFolder({
    ...existing,
    name,
    collapsed,
    updated_at: now,
  });
}

export function updateFolderForViewer(
  profileId: string,
  folderId: string,
  input: { name?: string; collapsed?: boolean }
) {
  const folder = getFolderRowById(folderId);
  if (folder.profile_id === profileId) {
    return updateFolder(profileId, folderId, input);
  }

  const membership = getFolderMemberRow(folderId, profileId);
  if (!membership) {
    throw new Error("Folder not accessible.");
  }

  if (input.name !== undefined) {
    throw new Error("Only the folder owner can rename it.");
  }

  const toSharedFolder = (collapsed: number) => ({
    id: folder.id,
    profileId: folder.profile_id,
    name: folder.name,
    collapsed: Boolean(collapsed),
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
    scope: "shared" as const,
  });

  if (input.collapsed !== undefined) {
    const collapsed = input.collapsed ? 1 : 0;
    const db = getDb();
    db.prepare(
      `
        UPDATE chat_folder_members
        SET collapsed = ?
        WHERE folder_id = ? AND profile_id = ?
      `
    ).run(collapsed, folderId, profileId);
    return toSharedFolder(collapsed);
  }

  return toSharedFolder(membership.collapsed);
}

export function renameFolder(profileId: string, folderId: string, input: { name: string }) {
  return updateFolder(profileId, folderId, { name: input.name });
}

export function setFolderCollapsed(
  profileId: string,
  folderId: string,
  input: { collapsed: boolean }
) {
  return updateFolder(profileId, folderId, { collapsed: input.collapsed });
}

export function deleteFolder(profileId: string, folderId: string) {
  const db = getDb();
  getFolderRow(profileId, folderId);

  const tx = db.transaction(() => {
    db.prepare(
      `
        UPDATE chats
        SET folder_id = NULL
        WHERE profile_id = ? AND folder_id = ?
      `
    ).run(profileId, folderId);

    db.prepare(`DELETE FROM chat_folders WHERE id = ? AND profile_id = ?`).run(
      folderId,
      profileId
    );
  });

  tx();
}

export function shareFolder(
  profileId: string,
  folderId: string,
  input: { targetProfile: string }
) {
  const folder = getFolderRow(profileId, folderId);
  const targetHint = normalizeSpaces(String(input.targetProfile ?? ""));
  if (!targetHint) {
    throw new Error("Target profile is required.");
  }
  const target = resolveProfileIdentifier(targetHint);
  if (target.id === folder.profile_id) {
    throw new Error("You cannot share a folder with its owner.");
  }

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT OR IGNORE INTO chat_folder_members (folder_id, profile_id, collapsed, created_at)
      VALUES (?, ?, 0, ?)
    `
  ).run(folderId, target.id, now);
}

export function unshareFolder(
  profileId: string,
  folderId: string,
  input: { targetProfile: string }
) {
  const folder = getFolderRow(profileId, folderId);
  const targetHint = normalizeSpaces(String(input.targetProfile ?? ""));
  if (!targetHint) {
    throw new Error("Target profile is required.");
  }
  const target = resolveProfileIdentifier(targetHint);
  if (target.id === folder.profile_id) {
    throw new Error("Cannot remove the folder owner.");
  }

  const db = getDb();
  db.prepare(
    `DELETE FROM chat_folder_members WHERE folder_id = ? AND profile_id = ?`
  ).run(folderId, target.id);
}

export function listFolderMembers(profileId: string, folderId: string) {
  getFolderRow(profileId, folderId);
  const db = getDb();
  const rows = db
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
      `
    )
    .all(folderId) as FolderMemberWithProfileRow[];

  return rows.map((row) => ({
    profileId: row.profile_id,
    name: row.name,
    createdAt: row.created_at,
  }));
}
