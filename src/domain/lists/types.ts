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
