import { nanoid } from "nanoid";
import { getDb } from "@/server/db";
import type {
  TaskList,
  TaskListItem,
  TaskListKind,
  TaskListOverview,
} from "@/lib/types";

const MAX_LIST_NAME_LENGTH = 80;
const MAX_ITEM_LENGTH = 200;
const MAX_ITEMS = 200;

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

function normalizeSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeListName(name: string) {
  return normalizeSpaces(name);
}

function normalizeItemText(text: string) {
  return normalizeSpaces(text).toLowerCase();
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
      `Multiple profiles are named "${identifier}". Rename one to share lists.`
    );
  }
  return matches[0];
}

function inferKindFromName(name: string): TaskListKind {
  const lower = name.toLowerCase();
  const groceryHints = [
    "grocery",
    "groceries",
    "shopping list",
    "shopping",
    "boodschappen",
    "boodschappenlijst",
    "boodschappen lijst",
  ];
  if (groceryHints.some((hint) => lower.includes(hint))) return "grocery";
  return "todo";
}

function resolveKind(name: string, hint?: string): TaskListKind {
  if (hint === "grocery" || hint === "todo") return hint;
  if (!name) return "todo";
  return inferKindFromName(name);
}

function defaultNameForKind(kind: TaskListKind) {
  return kind === "grocery" ? "Boodschappen" : "To-do";
}

function rowToItem(row: ItemRow): TaskListItem {
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

function listItems(listId: string): TaskListItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id, list_id, content, completed, created_at, updated_at, position
        FROM list_items
        WHERE list_id = ?
        ORDER BY completed ASC, position ASC, created_at ASC
      `
    )
    .all(listId) as ItemRow[];
  return rows.map(rowToItem);
}

function listShareCount(listId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(1) as count FROM list_members WHERE list_id = ?`
    )
    .get(listId) as { count?: number } | undefined;
  return row?.count ?? 0;
}

function listToTaskList(listRow: ListRow): TaskList {
  const items = listItems(listRow.id);
  const sharedCount = listShareCount(listRow.id);
  const total = items.length;
  const completed = items.filter((item) => item.completed).length;
  const remaining = total - completed;
  return {
    id: listRow.id,
    profileId: listRow.profile_id,
    name: listRow.name,
    kind: listRow.kind,
    createdAt: listRow.created_at,
    updatedAt: listRow.updated_at,
    items,
    sharedCount,
    deleted: false,
    stats: { total, completed, remaining },
  };
}

function ensureListName(name: string) {
  const trimmed = normalizeListName(name);
  if (!trimmed) {
    throw new Error("List name is required.");
  }
  if (trimmed.length > MAX_LIST_NAME_LENGTH) {
    throw new Error("List name is too long.");
  }
  return trimmed;
}

function getListById(profileId: string, listId: string): ListRow | null {
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
      `
    )
    .get(listId, profileId, profileId) as ListRow | undefined;
  return row ?? null;
}

function getListByName(profileId: string, name: string): ListRow | null {
  if (!name) return null;
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, profile_id, name, kind, created_at, updated_at
        FROM lists
        WHERE profile_id = ? AND lower(name) = lower(?)
      `
    )
    .get(profileId, name) as ListRow | undefined;
  return row ?? null;
}

function findAccessibleListsByName(input: {
  profileId: string;
  name: string;
  ownerProfileId?: string;
}): ListRow[] {
  const name = normalizeListName(input.name);
  if (!name) return [];
  const db = getDb();
  const params: Array<string> = [name, input.profileId, input.profileId];
  const ownerFilter = input.ownerProfileId
    ? "AND lists.profile_id = ?"
    : "";
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
      `
    )
    .all(...params) as ListRow[];
  return rows;
}

function createList(profileId: string, name: string, kind: TaskListKind) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = nanoid();
  const safeName = ensureListName(name);
  try {
    db.prepare(
      `
        INSERT INTO lists (id, profile_id, name, kind, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(id, profileId, safeName, kind, now, now);
    return getListById(profileId, id)!;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed: lists.profile_id, lists.name")
    ) {
      const existing = getListByName(profileId, safeName);
      if (existing) return existing;
    }
    throw err;
  }
}

function resolveListRow(input: {
  profileId: string;
  listId?: string;
  listName?: string;
  listKind?: string;
  listOwner?: string;
  allowCreate?: boolean;
}): ListRow {
  const listId = (input.listId ?? "").trim();
  const listName = normalizeListName(String(input.listName ?? ""));
  const kind = resolveKind(listName, input.listKind);
  const fallbackName = listName || defaultNameForKind(kind);
  const ownerHint = normalizeSpaces(String(input.listOwner ?? ""));
  const ownerProfileId = ownerHint
    ? resolveProfileIdentifier(ownerHint).id
    : undefined;

  let row = listId ? getListById(input.profileId, listId) : null;
  if (!row) {
    const searchName = listName || fallbackName;
    if (searchName) {
      const matches = findAccessibleListsByName({
        profileId: input.profileId,
        name: searchName,
        ownerProfileId,
      });
      if (matches.length > 1) {
        throw new Error(
          `Multiple lists are named "${searchName}". Ask which profile owns it.`
        );
      }
      row = matches[0] ?? null;
    }
  }
  if (!row) {
    if (input.allowCreate === false) {
      throw new Error(
        ownerProfileId && ownerProfileId !== input.profileId
          ? "List not found for that profile."
          : "List not found."
      );
    }
    if (ownerProfileId && ownerProfileId !== input.profileId) {
      throw new Error("List not found for that profile.");
    }
    row = createList(input.profileId, fallbackName, kind);
  }
  return row;
}

function touchList(listId: string, updatedAt: string) {
  const db = getDb();
  db.prepare(`UPDATE lists SET updated_at = ? WHERE id = ?`).run(
    updatedAt,
    listId
  );
}

function addItemsToList(listId: string, items: string[]) {
  const db = getDb();
  const now = new Date().toISOString();
  const existingCount =
    (db
      .prepare(`SELECT COUNT(1) as count FROM list_items WHERE list_id = ?`)
      .get(listId) as { count?: number }).count ?? 0;
  if (existingCount + items.length > MAX_ITEMS) {
    throw new Error("List has too many items.");
  }

  const positionRow = db
    .prepare(
      `SELECT COALESCE(MAX(position), 0) as max_position FROM list_items WHERE list_id = ?`
    )
    .get(listId) as { max_position?: number };
  let position = positionRow.max_position ?? 0;

  const insert = db.prepare(
    `
      INSERT INTO list_items
        (id, list_id, content, completed, created_at, updated_at, position)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  );

  for (const raw of items) {
    const content = normalizeListName(String(raw ?? ""));
    if (!content) continue;
    if (content.length > MAX_ITEM_LENGTH) {
      throw new Error("List item is too long.");
    }
    position += 1;
    insert.run(nanoid(), listId, content, 0, now, now, position);
  }
  touchList(listId, now);
}

function resolveItemIds(listId: string, itemIds: string[], items: string[]) {
  const existing = listItems(listId);
  const normalized = new Map(
    existing.map((item) => [normalizeItemText(item.content), item.id])
  );
  const resolved = new Set<string>();
  for (const id of itemIds) {
    const trimmed = String(id ?? "").trim();
    if (trimmed) resolved.add(trimmed);
  }
  for (const item of items) {
    const key = normalizeItemText(String(item ?? ""));
    if (!key) continue;
    const id = normalized.get(key);
    if (id) resolved.add(id);
  }
  return Array.from(resolved);
}

function toggleItems(listId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const select = db.prepare(
    `SELECT id, completed FROM list_items WHERE id = ? AND list_id = ?`
  );
  const update = db.prepare(
    `UPDATE list_items SET completed = ?, updated_at = ? WHERE id = ?`
  );
  for (const id of itemIds) {
    const row = select.get(id, listId) as { completed?: number } | undefined;
    if (!row) continue;
    const next = row.completed ? 0 : 1;
    update.run(next, now, id);
  }
  touchList(listId, now);
}

function removeItems(listId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;
  const db = getDb();
  const remove = db.prepare(
    `DELETE FROM list_items WHERE id = ? AND list_id = ?`
  );
  for (const id of itemIds) {
    remove.run(id, listId);
  }
  touchList(listId, new Date().toISOString());
}

function clearCompleted(listId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM list_items WHERE list_id = ? AND completed = 1`).run(
    listId
  );
  touchList(listId, new Date().toISOString());
}

function renameList(listRow: ListRow, newName: string) {
  const db = getDb();
  const name = ensureListName(newName);
  const existing = getListByName(listRow.profile_id, name);
  if (existing && existing.id !== listRow.id) {
    throw new Error("A list with that name already exists.");
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE lists SET name = ?, updated_at = ? WHERE id = ?`).run(
    name,
    now,
    listRow.id
  );
}

function deleteList(listRow: ListRow) {
  const db = getDb();
  db.prepare(`DELETE FROM lists WHERE id = ? AND profile_id = ?`).run(
    listRow.id,
    listRow.profile_id
  );
}

function buildDeletedList(listRow: ListRow): TaskList {
  const now = new Date().toISOString();
  return {
    id: listRow.id,
    profileId: listRow.profile_id,
    name: listRow.name,
    kind: listRow.kind,
    createdAt: listRow.created_at,
    updatedAt: now,
    items: [],
    sharedCount: 0,
    deleted: true,
    stats: { total: 0, completed: 0, remaining: 0 },
  };
}

function shareListWithProfile(listRow: ListRow, targetProfileId: string) {
  if (!targetProfileId || targetProfileId === listRow.profile_id) return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT OR IGNORE INTO list_members (list_id, profile_id, created_at)
      VALUES (?, ?, ?)
    `
  ).run(listRow.id, targetProfileId, now);
  touchList(listRow.id, now);
}

function unshareListWithProfile(listRow: ListRow, targetProfileId: string) {
  if (!targetProfileId || targetProfileId === listRow.profile_id) {
    throw new Error("Cannot remove the list owner.");
  }
  const db = getDb();
  db.prepare(
    `DELETE FROM list_members WHERE list_id = ? AND profile_id = ?`
  ).run(listRow.id, targetProfileId);
  touchList(listRow.id, new Date().toISOString());
}

export type ListActionInput = {
  action:
    | "show"
    | "create"
    | "add_items"
    | "toggle_items"
    | "remove_items"
    | "clear_completed"
    | "rename_list"
    | "delete_list"
    | "share_list"
    | "unshare_list";
  listId?: string;
  listName?: string;
  listKind?: string;
  listOwner?: string;
  items?: string[];
  itemIds?: string[];
  newName?: string;
  targetProfile?: string;
};

export function runListAction(
  profileId: string,
  input: ListActionInput
): TaskList {
  const items = Array.isArray(input.items)
    ? input.items.map((item) => normalizeListName(String(item ?? ""))).filter(Boolean)
    : [];
  const itemIds = Array.isArray(input.itemIds)
    ? input.itemIds.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  const allowCreate =
    input.action === "create" ||
    input.action === "add_items" ||
    (input.action === "show" && items.length > 0);

  const listRow = resolveListRow({
    profileId,
    listId: input.listId,
    listName: input.listName,
    listKind: input.listKind,
    listOwner: input.listOwner,
    allowCreate,
  });
  const isOwner = listRow.profile_id === profileId;

  switch (input.action) {
    case "create":
    case "show":
      if (items.length > 0) {
        addItemsToList(listRow.id, items);
      }
      break;
    case "add_items":
      addItemsToList(listRow.id, items);
      break;
    case "toggle_items": {
      const resolvedIds = resolveItemIds(listRow.id, itemIds, items);
      toggleItems(listRow.id, resolvedIds);
      break;
    }
    case "remove_items": {
      const resolvedIds = resolveItemIds(listRow.id, itemIds, items);
      removeItems(listRow.id, resolvedIds);
      break;
    }
    case "clear_completed":
      clearCompleted(listRow.id);
      break;
    case "rename_list":
      if (!isOwner) {
        throw new Error("Only the list owner can rename it.");
      }
      renameList(listRow, normalizeListName(String(input.newName ?? "")));
      break;
    case "delete_list": {
      if (!isOwner) {
        throw new Error("Only the list owner can delete it.");
      }
      const deleted = buildDeletedList(listRow);
      deleteList(listRow);
      return deleted;
    }
    case "share_list": {
      if (!isOwner) {
        throw new Error("Only the list owner can share it.");
      }
      const targetHint = normalizeSpaces(String(input.targetProfile ?? ""));
      if (!targetHint) {
        throw new Error("Target profile is required.");
      }
      const target = resolveProfileIdentifier(targetHint);
      shareListWithProfile(listRow, target.id);
      break;
    }
    case "unshare_list": {
      if (!isOwner) {
        throw new Error("Only the list owner can stop sharing it.");
      }
      const targetHint = normalizeSpaces(String(input.targetProfile ?? ""));
      if (!targetHint) {
        throw new Error("Target profile is required.");
      }
      const target = resolveProfileIdentifier(targetHint);
      unshareListWithProfile(listRow, target.id);
      break;
    }
    default:
      throw new Error("Unsupported list action.");
  }

  const refreshed = getListById(profileId, listRow.id);
  if (!refreshed) {
    throw new Error("List not found.");
  }
  return listToTaskList(refreshed);
}

export function listProfileLists(profileId: string): TaskList[] {
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
      `
    )
    .all(profileId, profileId, profileId) as ListRow[];
  return rows.map(listToTaskList);
}

export function listProfileListOverviews(profileId: string): TaskListOverview[] {
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
      `
    )
    .all(profileId, profileId, profileId) as ListOverviewRow[];

  return rows.map((row) => {
    const scope = row.profile_id === profileId ? "owned" : "shared";
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      ownerProfileId: row.profile_id,
      ownerProfileName: row.owner_name,
      updatedAt: row.updated_at,
      scope,
    };
  });
}
