"use client";

import type { ReactNode } from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";
import type { Profile } from "@/domain/profiles/types";
import {
  HomeClientSidebarChatLists,
} from "@/app/home-client-sidebar-chat-lists";
import {
  HomeClientSidebarFolders,
} from "@/app/home-client-sidebar-folders";
import {
  HomeClientSidebarProfile,
} from "@/app/home-client-sidebar-profile";
import {
  HomeClientSidebarShellHeader,
  HomeClientSidebarToolbar,
} from "@/app/home-client-sidebar-shell";

type HomeClientSidebarProps = {
  activeProfile: Profile | null;
  appVersion: string;
  archivedChats: AccessibleChat[];
  archivedOpen: boolean;
  chats: AccessibleChat[];
  deleteChatError: string | null;
  desktopSidebarCollapsed: boolean;
  folderActionsDisabled: (folder: AccessibleChatFolder) => boolean;
  folderError: string | null;
  folderGroupCollapsed: Record<string, boolean>;
  mode: "desktop" | "drawer";
  onArchivedOpenChange: (open: boolean) => void;
  onCloseDrawer: () => void;
  onCollapseDesktop: () => void;
  onCreateChat: () => void;
  onCreateFolder: () => void;
  onCreateProfile: () => void;
  onDeleteFolder: (folderId: string) => void;
  onManageFolderSharing: (folderId: string) => void;
  onOpenChangeProfileSelect: (open: boolean) => void;
  onOpenProfileSettings: () => void;
  onRenameFolder: (folderId: string) => void;
  onSelectProfile: (profileId: string) => void;
  onSetFolderGroupCollapsedValue: (
    groupId: string,
    collapsed: boolean
  ) => void;
  onShareFolder: (folderId: string) => void;
  onToggleFolderCollapsed: (folderId: string, collapsed: boolean) => void;
  ownedFolders: AccessibleChatFolder[];
  profiles: Profile[];
  renderArchivedChatRow: (chat: AccessibleChat) => ReactNode;
  renderChatRow: (chat: AccessibleChat) => ReactNode;
  rootChats: AccessibleChat[];
  sharedFoldersByOwner: Array<[string, AccessibleChatFolder[]]>;
  showFoldersSeparator: boolean;
  statusReady: boolean;
  t: I18nContextValue["t"];
};

export function HomeClientSidebar({
  activeProfile,
  appVersion,
  archivedChats,
  archivedOpen,
  chats,
  deleteChatError,
  desktopSidebarCollapsed,
  folderActionsDisabled,
  folderError,
  folderGroupCollapsed,
  mode,
  onArchivedOpenChange,
  onCloseDrawer,
  onCollapseDesktop,
  onCreateChat,
  onCreateFolder,
  onCreateProfile,
  onDeleteFolder,
  onManageFolderSharing,
  onOpenChangeProfileSelect,
  onOpenProfileSettings,
  onRenameFolder,
  onSelectProfile,
  onSetFolderGroupCollapsedValue,
  onShareFolder,
  onToggleFolderCollapsed,
  ownedFolders,
  profiles,
  renderArchivedChatRow,
  renderChatRow,
  rootChats,
  sharedFoldersByOwner,
  showFoldersSeparator,
  statusReady,
  t,
}: HomeClientSidebarProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar text-sidebar-foreground">
      <HomeClientSidebarShellHeader
        desktopSidebarCollapsed={desktopSidebarCollapsed}
        mode={mode}
        onCloseDrawer={onCloseDrawer}
        onCollapseDesktop={onCollapseDesktop}
        t={t}
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
        <HomeClientSidebarToolbar
          activeProfileAvailable={Boolean(activeProfile)}
          deleteChatError={deleteChatError}
          folderError={folderError}
          onCreateChat={onCreateChat}
          onCreateFolder={onCreateFolder}
          statusReady={statusReady}
          t={t}
        />

        <div className="space-y-1 px-1 pb-2" data-testid="sidebar:chats-active">
          <HomeClientSidebarFolders
            chats={chats}
            folderActionsDisabled={folderActionsDisabled}
            folderGroupCollapsed={folderGroupCollapsed}
            onDeleteFolder={onDeleteFolder}
            onManageFolderSharing={onManageFolderSharing}
            onRenameFolder={onRenameFolder}
            onSetFolderGroupCollapsedValue={onSetFolderGroupCollapsedValue}
            onShareFolder={onShareFolder}
            onToggleFolderCollapsed={onToggleFolderCollapsed}
            ownedFolders={ownedFolders}
            renderChatRow={renderChatRow}
            sharedFoldersByOwner={sharedFoldersByOwner}
            t={t}
          />

          <HomeClientSidebarChatLists
            archivedChats={archivedChats}
            archivedOpen={archivedOpen}
            onArchivedOpenChange={onArchivedOpenChange}
            renderArchivedChatRow={renderArchivedChatRow}
            renderRootChatRow={renderChatRow}
            rootChats={rootChats}
            showFoldersSeparator={showFoldersSeparator}
            t={t}
          />
        </div>
      </div>

      <HomeClientSidebarProfile
        activeProfile={activeProfile}
        appVersion={appVersion}
        onCreateProfile={onCreateProfile}
        onOpenChangeProfileSelect={onOpenChangeProfileSelect}
        onOpenProfileSettings={onOpenProfileSettings}
        onSelectProfile={onSelectProfile}
        profiles={profiles}
        statusReady={statusReady}
        t={t}
      />
    </div>
  );
}
