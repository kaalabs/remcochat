"use client";

import type { ComponentProps } from "react";

import { HomeClientSidebarController } from "@/app/home-client-sidebar-controller";
import type {
  CreateHomeClientRootShellPropsInput,
  HomeClientSidebarControllerSharedProps,
} from "@/app/home-client-shell-types";

export function createHomeClientSidebarControllerSharedProps(
  input: CreateHomeClientRootShellPropsInput
): HomeClientSidebarControllerSharedProps {
  return {
    activeChatId: input.activeChatId,
    activeProfile: input.activeProfile,
    appVersion: input.appVersion,
    archivedOpen: input.archivedOpen,
    chats: input.chats,
    closeSidebarDrawer: input.closeSidebarDrawer,
    deleteChatError: input.chatActions.deleteChat.error,
    desktopSidebarCollapsed: input.desktopSidebarCollapsed,
    folderError: input.folderActions.folderError,
    folderGroupCollapsed: input.folderGroupCollapsed,
    hasArchivedChats: input.hasArchivedChats,
    isTemporaryChat: input.isTemporaryChat,
    onArchiveChatById: input.chatActions.archiveChatById,
    onArchivedOpenChange: input.onArchivedOpenChange,
    onCollapseDesktop: input.onCollapseDesktop,
    onCreateChat: input.createChat,
    onCreateFolder: input.onCreateFolder,
    onCreateProfile: input.onOpenCreateProfileFromSidebar,
    onDeleteChatById: input.chatActions.deleteChatById,
    onDeleteFolder: input.folderActions.openDeleteFolder,
    onExportChatById: input.chatActions.exportChatById,
    onManageFolderSharing: input.folderActions.openManageFolderSharing,
    onMoveChatToFolder: input.folderActions.moveChatToFolder,
    onOpenChangeProfileSelect: input.onSidebarProfileSelectOpenChange,
    onOpenProfileSettings: input.onOpenProfileSettingsFromSidebar,
    onOpenRenameChat: input.chatActions.openRenameChat,
    onOpenRenameFolder: input.folderActions.openRenameFolder,
    onOpenShareFolder: input.folderActions.openShareFolder,
    onSelectPersistedChat: input.onSelectPersistedSidebarChat,
    onSelectProfile: input.onSelectProfile,
    onSetFolderGroupCollapsedValue: input.setFolderGroupCollapsedValue,
    onToggleFolderCollapsed: input.folderActions.toggleFolderCollapsed,
    onTogglePinChatById: input.chatActions.togglePinChatById,
    onUnarchiveChatById: input.chatActions.unarchiveChatById,
    ownedFolders: input.ownedFolders,
    profiles: input.profiles,
    sharedFoldersByOwner: input.sharedFoldersByOwner,
    statusReady: input.chatSession.status === "ready",
    t: input.t,
  };
}

export function renderHomeClientSidebarController(
  props: HomeClientSidebarControllerSharedProps,
  mode: ComponentProps<typeof HomeClientSidebarController>["mode"]
) {
  return <HomeClientSidebarController {...props} mode={mode} />;
}
