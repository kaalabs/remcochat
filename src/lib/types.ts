import type { LanguageModelUsage } from "ai";

export type Profile = {
  id: string;
  name: string;
  createdAt: string;
  defaultModelId: string;
  customInstructions: string;
  customInstructionsRevision: number;
  memoryEnabled: boolean;
};

export type Chat = {
  id: string;
  profileId: string;
  title: string;
  modelId: string;
  chatInstructions: string;
  chatInstructionsRevision: number;
  activatedSkillNames: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  forkedFromChatId?: string | null;
  forkedFromMessageId?: string | null;
};

export type RemcoChatMessageMetadata = {
  createdAt?: string;
  turnUserMessageId?: string;
  profileInstructionsRevision?: number;
  chatInstructionsRevision?: number;
  usage?: LanguageModelUsage;
};

export type MemoryItem = {
  id: string;
  profileId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskListKind = "todo" | "grocery";

export type TaskListItem = {
  id: string;
  listId: string;
  content: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  position: number;
};

export type TaskList = {
  id: string;
  profileId: string;
  name: string;
  kind: TaskListKind;
  createdAt: string;
  updatedAt: string;
  items: TaskListItem[];
  sharedCount: number;
  deleted?: boolean;
  stats: {
    total: number;
    completed: number;
    remaining: number;
  };
};

export type TaskListOverview = {
  id: string;
  name: string;
  kind: TaskListKind;
  ownerProfileId: string;
  ownerProfileName: string;
  updatedAt: string;
  scope: "owned" | "shared";
};

export type ListsOverviewToolOutput = {
  lists: TaskListOverview[];
  counts: {
    owned: number;
    shared: number;
    total: number;
  };
};

export type QuickNote = {
  id: string;
  profileId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type NotesToolOutput = {
  notes: QuickNote[];
  totalCount: number;
  limit: number;
};

export type AgendaItem = {
  id: string;
  profileId: string;
  description: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  timezone: string;
  ownerProfileId: string;
  ownerProfileName?: string;
  scope: "owned" | "shared";
  sharedWithCount: number;
  localDate: string;
  localTime: string;
  viewerLocalDate: string;
  viewerLocalTime: string;
};

export type AgendaToolOutput =
  | {
      ok: true;
      action: "create" | "update" | "delete" | "share" | "unshare";
      message: string;
      item?: AgendaItem;
      items?: AgendaItem[];
    }
  | {
      ok: true;
      action: "list";
      rangeLabel: string;
      timezone: string;
      items: AgendaItem[];
    }
  | {
      ok: false;
      error: string;
      candidates?: AgendaItem[];
    };
