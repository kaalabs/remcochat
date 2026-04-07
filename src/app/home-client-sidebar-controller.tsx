"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";
import type { Profile } from "@/domain/profiles/types";

import {
  chatIsPinned,
  compareChatsForSidebar,
} from "@/app/home-client-chat-actions";
import { HomeClientSidebar } from "@/app/home-client-sidebar";
import {
  HomeClientSidebarChatRow,
} from "@/app/home-client-sidebar-chats";

type HomeClientSidebarControllerProps = {
  activeChatId: string;
  activeProfile: Profile | null;
  appVersion: string;
  archivedOpen: boolean;
  chats: AccessibleChat[];
  closeSidebarDrawer: () => void;
  deleteChatError: string | null;
  desktopSidebarCollapsed: boolean;
  folderError: string | null;
  folderGroupCollapsed: Record<string, boolean>;
  hasArchivedChats: boolean;
  isTemporaryChat: boolean;
  mode: "desktop" | "drawer";
  onArchiveChatById: (chatId: string) => void;
  onArchivedOpenChange: (open: boolean) => void;
  onCollapseDesktop: () => void;
  onCreateChat: () => void;
  onCreateFolder: () => void;
  onCreateProfile: () => void;
  onDeleteChatById: (chatId: string, folderIdHint?: string | null) => void;
  onDeleteFolder: (folderId: string) => void;
  onExportChatById: (chatId: string, format: "json" | "md") => void;
  onManageFolderSharing: (folderId: string) => void;
  onMoveChatToFolder: (chatId: string, folderId: string | null) => void;
  onOpenChangeProfileSelect: (open: boolean) => void;
  onOpenProfileSettings: () => void;
  onOpenRenameChat: (chatId: string) => void;
  onOpenRenameFolder: (folderId: string) => void;
  onOpenShareFolder: (folderId: string) => void;
  onSelectPersistedChat: (chatId: string) => void;
  onSelectProfile: (profileId: string) => void;
  onSetFolderGroupCollapsedValue: (
    groupId: string,
    collapsed: boolean
  ) => void;
  onToggleFolderCollapsed: (folderId: string, collapsed: boolean) => void;
  onTogglePinChatById: (chatId: string, nextPinned: boolean) => void;
  onUnarchiveChatById: (chatId: string) => void;
  ownedFolders: AccessibleChatFolder[];
  profiles: Profile[];
  sharedFoldersByOwner: Array<[string, AccessibleChatFolder[]]>;
  statusReady: boolean;
  t: I18nContextValue["t"];
};

export function HomeClientSidebarController({
  activeChatId,
  activeProfile,
  appVersion,
  archivedOpen,
  chats,
  closeSidebarDrawer,
  deleteChatError,
  desktopSidebarCollapsed,
  folderError,
  folderGroupCollapsed,
  hasArchivedChats,
  isTemporaryChat,
  mode,
  onArchiveChatById,
  onArchivedOpenChange,
  onCollapseDesktop,
  onCreateChat,
  onCreateFolder,
  onCreateProfile,
  onDeleteChatById,
  onDeleteFolder,
  onExportChatById,
  onManageFolderSharing,
  onMoveChatToFolder,
  onOpenChangeProfileSelect,
  onOpenProfileSettings,
  onOpenRenameChat,
  onOpenRenameFolder,
  onOpenShareFolder,
  onSelectPersistedChat,
  onSelectProfile,
  onSetFolderGroupCollapsedValue,
  onToggleFolderCollapsed,
  onTogglePinChatById,
  onUnarchiveChatById,
  ownedFolders,
  profiles,
  sharedFoldersByOwner,
  statusReady,
  t,
}: HomeClientSidebarControllerProps) {
  const closeIfDrawer = () => {
    if (mode !== "drawer") return;
    closeSidebarDrawer();
  };

  const activeProfileId = activeProfile?.id ?? null;
  const sidebarChatPinDisabled = !activeProfile || !statusReady;

  const renderSidebarChatRow = (
    chat: AccessibleChat,
    options?: { archived?: boolean }
  ) => {
    const archived = Boolean(options?.archived);
    const actionsDisabled =
      !activeProfileId || !statusReady || chat.profileId !== activeProfileId;

    return (
      <HomeClientSidebarChatRow
        actionsDisabled={actionsDisabled}
        active={chat.id === activeChatId && !isTemporaryChat}
        archived={archived}
        chat={chat}
        key={chat.id}
        onArchive={
          archived
            ? undefined
            : () => {
                if (!activeProfileId || chat.profileId !== activeProfileId) return;
                onArchiveChatById(chat.id);
                closeIfDrawer();
              }
        }
        onDelete={() => {
          if (!activeProfileId || chat.profileId !== activeProfileId) return;
          onDeleteChatById(chat.id, chat.folderId);
          closeIfDrawer();
        }}
        onExport={(format) => {
          if (!activeProfileId || chat.profileId !== activeProfileId) return;
          onExportChatById(chat.id, format);
        }}
        onMoveToFolder={(folderId) => {
          onMoveChatToFolder(chat.id, folderId);
        }}
        onRename={() => {
          if (!activeProfileId || chat.profileId !== activeProfileId) return;
          onOpenRenameChat(chat.id);
        }}
        onSelect={() => {
          if (!activeProfile) return;
          onSelectPersistedChat(chat.id);
          closeIfDrawer();
        }}
        onTogglePin={
          archived
            ? undefined
            : () => {
                onTogglePinChatById(chat.id, !chatIsPinned(chat));
              }
        }
        onUnarchive={
          archived
            ? () => {
                if (!activeProfileId || chat.profileId !== activeProfileId) return;
                onUnarchiveChatById(chat.id);
                closeIfDrawer();
              }
            : undefined
        }
        ownedFolders={ownedFolders}
        pinDisabled={sidebarChatPinDisabled}
        t={t}
      />
    );
  };

  const rootChats = chats
    .filter((chat) => !chat.archivedAt && chat.folderId == null)
    .sort(compareChatsForSidebar);
  const archivedChats = chats.filter((chat) => Boolean(chat.archivedAt));
  const showFoldersSeparator =
    rootChats.length > 0 &&
    (ownedFolders.length > 0 || sharedFoldersByOwner.length > 0);

  return (
    <HomeClientSidebar
      activeProfile={activeProfile}
      appVersion={appVersion}
      archivedChats={archivedChats}
      archivedOpen={archivedOpen && hasArchivedChats}
      chats={chats}
      deleteChatError={deleteChatError}
      desktopSidebarCollapsed={desktopSidebarCollapsed}
      folderActionsDisabled={(folder) =>
        !activeProfileId || !statusReady || folder.profileId !== activeProfileId
      }
      folderError={folderError}
      folderGroupCollapsed={folderGroupCollapsed}
      mode={mode}
      onArchivedOpenChange={onArchivedOpenChange}
      onCloseDrawer={closeSidebarDrawer}
      onCollapseDesktop={onCollapseDesktop}
      onCreateChat={() => {
        onCreateChat();
        closeIfDrawer();
      }}
      onCreateFolder={onCreateFolder}
      onCreateProfile={() => {
        onCreateProfile();
        closeIfDrawer();
      }}
      onDeleteFolder={onDeleteFolder}
      onManageFolderSharing={onManageFolderSharing}
      onOpenChangeProfileSelect={onOpenChangeProfileSelect}
      onOpenProfileSettings={() => {
        onOpenProfileSettings();
        closeIfDrawer();
      }}
      onRenameFolder={onOpenRenameFolder}
      onSelectProfile={(profileId) => {
        onSelectProfile(profileId);
        closeIfDrawer();
      }}
      onSetFolderGroupCollapsedValue={onSetFolderGroupCollapsedValue}
      onShareFolder={onOpenShareFolder}
      onToggleFolderCollapsed={onToggleFolderCollapsed}
      ownedFolders={ownedFolders}
      profiles={profiles}
      renderArchivedChatRow={(chat) =>
        renderSidebarChatRow(chat, { archived: true })
      }
      renderChatRow={(chat) => renderSidebarChatRow(chat)}
      rootChats={rootChats}
      sharedFoldersByOwner={sharedFoldersByOwner}
      showFoldersSeparator={showFoldersSeparator}
      statusReady={statusReady}
      t={t}
    />
  );
}
