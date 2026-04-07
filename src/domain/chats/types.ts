import type { LanguageModelUsage } from "ai";

export type Chat = {
  id: string;
  profileId: string;
  title: string;
  modelId: string;
  folderId: string | null;
  pinnedAt: string | null;
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

export type AccessibleChat = Chat & {
  scope: "owned" | "shared";
  ownerName: string;
};

export type RemcoChatMessageMetadata = {
  createdAt?: string;
  turnUserMessageId?: string;
  profileInstructionsRevision?: number;
  chatInstructionsRevision?: number;
  usage?: LanguageModelUsage;
};
