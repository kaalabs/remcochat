export type UiLanguage = "en" | "nl";

export type ProfileAvatar = {
  mediaType: string;
  sizeBytes: number;
  updatedAt: string;
  position: { x: number; y: number };
};

export type Profile = {
  id: string;
  name: string;
  createdAt: string;
  defaultModelId: string;
  customInstructions: string;
  customInstructionsRevision: number;
  memoryEnabled: boolean;
  uiLanguage: UiLanguage;
  avatar: ProfileAvatar | null;
};
