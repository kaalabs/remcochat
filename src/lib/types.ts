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
};

export type MemoryItem = {
  id: string;
  profileId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
