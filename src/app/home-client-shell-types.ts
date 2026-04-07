"use client";

import type { UIMessage } from "ai";
import type { ComponentProps } from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type {
  AccessibleChat,
  RemcoChatMessageMetadata,
} from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";
import type { Profile } from "@/domain/profiles/types";
import { HomeClientMainColumn } from "@/app/home-client-main-column";
import { HomeClientOverlays } from "@/app/home-client-overlays";
import { HomeClientRootShell } from "@/app/home-client-root-shell";
import { HomeClientSidebarController } from "@/app/home-client-sidebar-controller";
import type { useHomeClientChatActions } from "@/app/home-client-chat-actions";
import type { useHomeClientChatSession } from "@/app/home-client-chat-session";
import type { useHomeClientChatSettings } from "@/app/home-client-chat-settings";
import type { useHomeClientCreateProfile } from "@/app/home-client-create-profile";
import type { useHomeClientEditFork } from "@/app/home-client-edit-fork";
import type { useHomeClientFolderActions } from "@/app/home-client-folder-actions";
import type { useHomeClientLanAdmin } from "@/app/home-client-lan-admin";
import type { useHomeClientMemorizeActions } from "@/app/home-client-temporary-mode";
import type { useHomeClientModelSelection } from "@/app/home-client-model-selection";
import type { useHomeClientProfileSettings } from "@/app/home-client-profile-settings";

export type HomeClientRootShellProps = ComponentProps<
  typeof HomeClientRootShell
>;
export type HomeClientMainColumnProps = ComponentProps<
  typeof HomeClientMainColumn
>;
export type HomeClientOverlaysProps = ComponentProps<
  typeof HomeClientOverlays
>;
export type HomeClientSidebarControllerSharedProps = Omit<
  ComponentProps<typeof HomeClientSidebarController>,
  "mode"
>;

export type HomeClientChatSessionShellState = Pick<
  ReturnType<typeof useHomeClientChatSession>,
  | "addToolApprovalResponse"
  | "attachmentUploadError"
  | "canSend"
  | "chatRequestBody"
  | "error"
  | "handleAttachmentCountChange"
  | "handleAttachmentError"
  | "handleComposerKeyDown"
  | "handlePromptSubmit"
  | "input"
  | "messages"
  | "regenerateLatest"
  | "retryLatest"
  | "sendMemoryDecision"
  | "sendOpenList"
  | "setInput"
  | "setMessages"
  | "showThinking"
  | "status"
  | "stop"
>;

export type HomeClientModelSelectionShellState = Pick<
  ReturnType<typeof useHomeClientModelSelection>,
  | "effectiveModelId"
  | "handleHeaderModelChange"
  | "modelOptions"
  | "providersLoadError"
  | "reasoningEffort"
  | "reasoningOptions"
  | "selectedModel"
  | "setReasoningEffort"
>;

export type HomeClientLanAdminShellState = Pick<
  ReturnType<typeof useHomeClientLanAdmin>,
  "clearLanAdminTokenState" | "lanAdminAccess" | "saveLanAdminToken"
>;

export type HomeClientFolderActionsShellState = Pick<
  ReturnType<typeof useHomeClientFolderActions>,
  | "confirmDeleteFolder"
  | "confirmShareFolder"
  | "createFolderByName"
  | "deleteFolder"
  | "folderError"
  | "manageSharing"
  | "moveChatToFolder"
  | "newFolder"
  | "openDeleteFolder"
  | "openManageFolderSharing"
  | "openRenameFolder"
  | "openShareFolder"
  | "renameFolder"
  | "saveRenameFolder"
  | "shareFolder"
  | "stopSharingFolderWithMember"
  | "toggleFolderCollapsed"
>;

export type HomeClientChatActionsShellState = Pick<
  ReturnType<typeof useHomeClientChatActions>,
  | "archiveChatById"
  | "canSaveRenameChat"
  | "deleteChat"
  | "deleteChatById"
  | "exportChatById"
  | "openRenameChat"
  | "renameChat"
  | "renameChatTitle"
  | "togglePinChatById"
  | "unarchiveChatById"
>;

export type HomeClientEditForkShellState = Pick<
  ReturnType<typeof useHomeClientEditFork>,
  "editFork" | "forkFromEdit" | "startEditUserMessage"
>;

export type HomeClientCreateProfileShellState = Pick<
  ReturnType<typeof useHomeClientCreateProfile>,
  "createProfile" | "saveCreateProfile"
>;

export type HomeClientProfileSettingsShellState = Pick<
  ReturnType<typeof useHomeClientProfileSettings>,
  | "avatarFileInputRef"
  | "chooseAvatarFile"
  | "confirmDeleteProfile"
  | "deleteMemory"
  | "deleteProfile"
  | "handleAvatarFileChange"
  | "profileSettings"
  | "removeAvatarDraft"
  | "saveProfileSettings"
>;

export type HomeClientMemorizeShellState = Pick<
  ReturnType<typeof useHomeClientMemorizeActions>,
  "memorize" | "saveMemorize" | "startMemorize"
>;

export type HomeClientChatSettingsShellState = Pick<
  ReturnType<typeof useHomeClientChatSettings>,
  "chatSettings" | "openChatSettings" | "saveChatSettings"
>;

export type CreateHomeClientRootShellPropsInput = {
  activeChat: AccessibleChat | null;
  activeChatId: string;
  activeProfile: Profile | null;
  adminEnabled: boolean;
  appVersion: string;
  archivedOpen: boolean;
  canManageActiveChat: boolean;
  chatActions: HomeClientChatActionsShellState;
  chatColumnMaxWidthClass: string;
  chatSession: HomeClientChatSessionShellState;
  chatSettingsController: HomeClientChatSettingsShellState;
  chats: AccessibleChat[];
  closeSidebarDrawer: () => void;
  createChat: () => void;
  createProfileController: HomeClientCreateProfileShellState;
  desktopGridStyle: HomeClientRootShellProps["desktopGridStyle"];
  desktopSidebarCollapsed: boolean;
  desktopSidebarResizing: boolean;
  editForkController: HomeClientEditForkShellState;
  endDesktopSidebarResize: HomeClientRootShellProps["onEndDesktopSidebarResize"];
  folderActions: HomeClientFolderActionsShellState;
  folderGroupCollapsed: Record<string, boolean>;
  handleSidebarDrawerOpenChange: HomeClientOverlaysProps["onDrawerOpenChange"];
  hasArchivedChats: boolean;
  isTemporaryChat: boolean;
  lanAdminAccessEnabled: boolean;
  lanAdminState: HomeClientLanAdminShellState;
  memorizeController: HomeClientMemorizeShellState;
  modelSelection: HomeClientModelSelectionShellState;
  onArchivedOpenChange: HomeClientSidebarControllerSharedProps["onArchivedOpenChange"];
  onCollapseDesktop: () => void;
  onCreateFolder: () => void;
  onExpandDesktopSidebar: () => void;
  onMoveDesktopSidebarResize: HomeClientRootShellProps["onMoveDesktopSidebarResize"];
  onOpenCreateProfileFromSidebar: () => void;
  onOpenLanAdmin: () => void;
  onOpenProfileSettingsFromSidebar: () => void;
  onOpenSidebar: () => void;
  onResetDesktopSidebarWidth: HomeClientRootShellProps["onResetDesktopSidebarWidth"];
  onSelectPersistedSidebarChat: (chatId: string) => void;
  onSelectProfile: (profileId: string) => void;
  onSetVariantsByUserMessageId: HomeClientMainColumnProps["transcript"]["setVariantsByUserMessageId"];
  onSidebarProfileSelectOpenChange: (open: boolean) => void;
  onToggleTemporaryChat: () => void;
  openingMessage: string;
  ownedFolders: AccessibleChatFolder[];
  profiles: Profile[];
  profileSettingsController: HomeClientProfileSettingsShellState;
  setFolderGroupCollapsedValue: (
    groupId: string,
    collapsed: boolean
  ) => void;
  sharedFoldersByOwner: Array<[string, AccessibleChatFolder[]]>;
  sidebarOpen: boolean;
  startDesktopSidebarResize: HomeClientRootShellProps["onStartDesktopSidebarResize"];
  stickToBottomContextRef: HomeClientMainColumnProps["transcript"]["stickToBottomContextRef"];
  t: I18nContextValue["t"];
  variantsByUserMessageId: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  >;
};
