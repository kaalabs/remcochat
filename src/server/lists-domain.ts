import type {
  TaskList,
  TaskListItem,
  TaskListKind,
} from "@/domain/lists/types";

const MAX_LIST_NAME_LENGTH = 80;
const MAX_ITEM_LENGTH = 200;
const MAX_ITEMS = 200;

export function normalizeListSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeListName(name: string) {
  return normalizeListSpaces(name);
}

export function normalizeListItemLookupKey(text: string) {
  return normalizeListSpaces(text).toLowerCase();
}

export function inferTaskListKindFromName(name: string): TaskListKind {
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

export function resolveTaskListKind(name: string, hint?: string): TaskListKind {
  if (hint === "grocery" || hint === "todo") return hint;
  if (!name) return "todo";
  return inferTaskListKindFromName(name);
}

export function defaultTaskListName(kind: TaskListKind) {
  return kind === "grocery" ? "Boodschappen" : "To-do";
}

export function ensureTaskListName(name: string) {
  const trimmed = normalizeListName(name);
  if (!trimmed) {
    throw new Error("List name is required.");
  }
  if (trimmed.length > MAX_LIST_NAME_LENGTH) {
    throw new Error("List name is too long.");
  }
  return trimmed;
}

export function ensureTaskListItemContent(content: string) {
  const normalized = normalizeListName(String(content ?? ""));
  if (!normalized) {
    throw new Error("List item is required.");
  }
  if (normalized.length > MAX_ITEM_LENGTH) {
    throw new Error("List item is too long.");
  }
  return normalized;
}

export function ensureCanAddTaskListItems(existingCount: number, itemCount: number) {
  if (existingCount + itemCount > MAX_ITEMS) {
    throw new Error("List has too many items.");
  }
}

export function buildTaskListStats(items: TaskListItem[]) {
  const total = items.length;
  const completed = items.filter((item) => item.completed).length;
  const remaining = total - completed;
  return { total, completed, remaining };
}

export function buildDeletedTaskList(input: {
  id: string;
  profileId: string;
  name: string;
  kind: TaskListKind;
  createdAt: string;
  updatedAt: string;
}): TaskList {
  return {
    id: input.id,
    profileId: input.profileId,
    name: input.name,
    kind: input.kind,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    items: [],
    sharedCount: 0,
    deleted: true,
    stats: { total: 0, completed: 0, remaining: 0 },
  };
}
