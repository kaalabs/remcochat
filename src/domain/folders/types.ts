export type ChatFolder = {
  id: string;
  profileId: string;
  name: string;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AccessibleChatFolder = ChatFolder & {
  scope: "owned" | "shared";
  ownerName: string;
  sharedWithCount: number;
};
