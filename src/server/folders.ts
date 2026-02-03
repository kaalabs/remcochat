import { nanoid } from "nanoid";
import { getDb } from "@/server/db";

const MAX_FOLDER_NAME_LENGTH = 60;

type ChatFolderRow = {
  id: string;
  profile_id: string;
  name: string;
  collapsed: number;
  created_at: string;
  updated_at: string;
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

