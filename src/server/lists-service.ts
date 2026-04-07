import { nanoid } from "nanoid";
import type {
  TaskList,
  TaskListOverview,
} from "@/domain/lists/types";
import {
  buildDeletedTaskList,
  defaultTaskListName,
  ensureCanAddTaskListItems,
  ensureTaskListItemContent,
  ensureTaskListName,
  normalizeListItemLookupKey,
  normalizeListName,
  normalizeListSpaces,
  resolveTaskListKind,
} from "@/server/lists-domain";
import {
  sqliteListsRepository,
  type ListsRepository,
  type StoredProfileLookup,
  type StoredTaskListRecord,
} from "@/server/lists-repository";

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

export type ListsService = {
  runListAction(profileId: string, input: ListActionInput): TaskList;
  listProfileLists(profileId: string): TaskList[];
  listProfileListOverviews(profileId: string): TaskListOverview[];
};

function normalizeInputItems(items: string[] | undefined): string[] {
  return Array.isArray(items)
    ? items.map((item) => normalizeListName(String(item ?? ""))).filter(Boolean)
    : [];
}

function normalizeInputItemIds(itemIds: string[] | undefined): string[] {
  return Array.isArray(itemIds)
    ? itemIds.map((itemId) => String(itemId ?? "").trim()).filter(Boolean)
    : [];
}

export function createListsService(repository: ListsRepository): ListsService {
  function resolveProfileIdentifier(identifier: string): StoredProfileLookup {
    const matches = repository.findProfilesByIdentifier(identifier);
    if (matches.length === 0) {
      throw new Error("Profile not found.");
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple profiles are named "${identifier}". Rename one to share lists.`,
      );
    }
    return matches[0]!;
  }

  function createOwnedList(profileId: string, name: string, kind: "todo" | "grocery") {
    const safeName = ensureTaskListName(name);
    try {
      return repository.createOwnedListRecord({
        id: nanoid(),
        profileId,
        name: safeName,
        kind,
        now: new Date().toISOString(),
      });
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed: lists.profile_id, lists.name")
      ) {
        const existing = repository.getOwnedListRecordByName(profileId, safeName);
        if (existing) return existing;
      }
      throw err;
    }
  }

  function resolveListRecord(input: {
    profileId: string;
    listId?: string;
    listName?: string;
    listKind?: string;
    listOwner?: string;
    allowCreate?: boolean;
  }): StoredTaskListRecord {
    const listId = (input.listId ?? "").trim();
    const listName = normalizeListName(String(input.listName ?? ""));
    const kind = resolveTaskListKind(listName, input.listKind);
    const fallbackName = listName || defaultTaskListName(kind);
    const ownerHint = normalizeListSpaces(String(input.listOwner ?? ""));
    const ownerProfileId = ownerHint
      ? resolveProfileIdentifier(ownerHint).id
      : undefined;

    let record = listId
      ? repository.getAccessibleListRecordById(input.profileId, listId)
      : null;
    if (!record) {
      const searchName = listName || fallbackName;
      if (searchName) {
        const matches = repository.findAccessibleListRecordsByName({
          profileId: input.profileId,
          name: searchName,
          ownerProfileId,
        });
        if (matches.length > 1) {
          throw new Error(
            `Multiple lists are named "${searchName}". Ask which profile owns it.`,
          );
        }
        record = matches[0] ?? null;
      }
    }
    if (!record) {
      if (input.allowCreate === false) {
        throw new Error(
          ownerProfileId && ownerProfileId !== input.profileId
            ? "List not found for that profile."
            : "List not found.",
        );
      }
      if (ownerProfileId && ownerProfileId !== input.profileId) {
        throw new Error("List not found for that profile.");
      }
      record = createOwnedList(input.profileId, fallbackName, kind);
    }
    return record;
  }

  function addItemsToList(listId: string, items: string[]) {
    const now = new Date().toISOString();
    ensureCanAddTaskListItems(repository.countListItems(listId), items.length);
    let position = repository.getMaxListItemPosition(listId);
    for (const raw of items) {
      const content = ensureTaskListItemContent(raw);
      position += 1;
      repository.insertListItem({
        id: nanoid(),
        listId,
        content,
        completed: false,
        createdAt: now,
        updatedAt: now,
        position,
      });
    }
    repository.touchList(listId, now);
  }

  function resolveItemIds(listId: string, itemIds: string[], items: string[]) {
    const existing = repository.listListItems(listId);
    const normalized = new Map(
      existing.map((item) => [normalizeListItemLookupKey(item.content), item.id]),
    );
    const resolved = new Set<string>();
    for (const itemId of itemIds) {
      const trimmed = String(itemId ?? "").trim();
      if (trimmed) resolved.add(trimmed);
    }
    for (const item of items) {
      const key = normalizeListItemLookupKey(String(item ?? ""));
      if (!key) continue;
      const itemId = normalized.get(key);
      if (itemId) resolved.add(itemId);
    }
    return Array.from(resolved);
  }

  function toggleItems(listId: string, itemIds: string[]) {
    if (itemIds.length === 0) return;
    const now = new Date().toISOString();
    for (const itemId of itemIds) {
      const completed = repository.getListItemCompletion(listId, itemId);
      if (completed == null) continue;
      repository.updateListItemCompletion({
        itemId,
        completed: !completed,
        updatedAt: now,
      });
    }
    repository.touchList(listId, now);
  }

  function removeItems(listId: string, itemIds: string[]) {
    if (itemIds.length === 0) return;
    for (const itemId of itemIds) {
      repository.deleteListItem(listId, itemId);
    }
    repository.touchList(listId, new Date().toISOString());
  }

  function clearCompletedItems(listId: string) {
    repository.deleteCompletedItems(listId);
    repository.touchList(listId, new Date().toISOString());
  }

  function renameOwnedList(listRecord: StoredTaskListRecord, newName: string) {
    const name = ensureTaskListName(newName);
    const existing = repository.getOwnedListRecordByName(listRecord.profileId, name);
    if (existing && existing.id !== listRecord.id) {
      throw new Error("A list with that name already exists.");
    }
    repository.renameOwnedList({
      listId: listRecord.id,
      name,
      updatedAt: new Date().toISOString(),
    });
  }

  function shareListWithProfile(listRecord: StoredTaskListRecord, targetProfileId: string) {
    if (!targetProfileId || targetProfileId === listRecord.profileId) return;
    const now = new Date().toISOString();
    repository.addListMember({
      listId: listRecord.id,
      profileId: targetProfileId,
      createdAt: now,
    });
    repository.touchList(listRecord.id, now);
  }

  function unshareListWithProfile(listRecord: StoredTaskListRecord, targetProfileId: string) {
    if (!targetProfileId || targetProfileId === listRecord.profileId) {
      throw new Error("Cannot remove the list owner.");
    }
    repository.removeListMember(listRecord.id, targetProfileId);
    repository.touchList(listRecord.id, new Date().toISOString());
  }

  function listProfileLists(profileId: string) {
    return repository
      .listAccessibleTaskListRecords(profileId)
      .map((record) => repository.hydrateTaskList(record));
  }

  return {
    runListAction(profileId, input) {
      const items = normalizeInputItems(input.items);
      const itemIds = normalizeInputItemIds(input.itemIds);
      const allowCreate =
        input.action === "create" ||
        input.action === "add_items" ||
        (input.action === "show" && items.length > 0);

      const listRecord = resolveListRecord({
        profileId,
        listId: input.listId,
        listName: input.listName,
        listKind: input.listKind,
        listOwner: input.listOwner,
        allowCreate,
      });
      const isOwner = listRecord.profileId === profileId;

      switch (input.action) {
        case "create":
        case "show":
          if (items.length > 0) {
            addItemsToList(listRecord.id, items);
          }
          break;
        case "add_items":
          addItemsToList(listRecord.id, items);
          break;
        case "toggle_items":
          toggleItems(listRecord.id, resolveItemIds(listRecord.id, itemIds, items));
          break;
        case "remove_items":
          removeItems(listRecord.id, resolveItemIds(listRecord.id, itemIds, items));
          break;
        case "clear_completed":
          clearCompletedItems(listRecord.id);
          break;
        case "rename_list":
          if (!isOwner) {
            throw new Error("Only the list owner can rename it.");
          }
          renameOwnedList(listRecord, normalizeListName(String(input.newName ?? "")));
          break;
        case "delete_list":
          if (!isOwner) {
            throw new Error("Only the list owner can delete it.");
          }
          repository.deleteOwnedList(listRecord.id, listRecord.profileId);
          return buildDeletedTaskList({
            ...listRecord,
            updatedAt: new Date().toISOString(),
          });
        case "share_list": {
          if (!isOwner) {
            throw new Error("Only the list owner can share it.");
          }
          const targetHint = normalizeListSpaces(String(input.targetProfile ?? ""));
          if (!targetHint) {
            throw new Error("Target profile is required.");
          }
          const target = resolveProfileIdentifier(targetHint);
          shareListWithProfile(listRecord, target.id);
          break;
        }
        case "unshare_list": {
          if (!isOwner) {
            throw new Error("Only the list owner can stop sharing it.");
          }
          const targetHint = normalizeListSpaces(String(input.targetProfile ?? ""));
          if (!targetHint) {
            throw new Error("Target profile is required.");
          }
          const target = resolveProfileIdentifier(targetHint);
          unshareListWithProfile(listRecord, target.id);
          break;
        }
        default:
          throw new Error("Unsupported list action.");
      }

      const refreshed = repository.getAccessibleListRecordById(profileId, listRecord.id);
      if (!refreshed) {
        throw new Error("List not found.");
      }
      return repository.hydrateTaskList(refreshed);
    },

    listProfileLists,

    listProfileListOverviews(profileId) {
      return repository.listAccessibleTaskListOverviews(profileId);
    },
  };
}

export const listsService = createListsService(sqliteListsRepository);
export const runListAction = listsService.runListAction;
export const listProfileLists = listsService.listProfileLists;
export const listProfileListOverviews = listsService.listProfileListOverviews;
