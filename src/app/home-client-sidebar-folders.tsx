"use client";

import type { ReactNode } from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AccessibleChat } from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";
import {
  FolderIcon,
  FolderOpenIcon,
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";

import { compareChatsForSidebar } from "@/app/home-client-chat-actions";

type HomeClientSidebarFoldersProps = {
  chats: AccessibleChat[];
  folderActionsDisabled: (folder: AccessibleChatFolder) => boolean;
  folderGroupCollapsed: Record<string, boolean>;
  onDeleteFolder: (folderId: string) => void;
  onManageFolderSharing: (folderId: string) => void;
  onRenameFolder: (folderId: string) => void;
  onSetFolderGroupCollapsedValue: (
    groupId: string,
    collapsed: boolean
  ) => void;
  onShareFolder: (folderId: string) => void;
  onToggleFolderCollapsed: (folderId: string, collapsed: boolean) => void;
  ownedFolders: AccessibleChatFolder[];
  renderChatRow: (chat: AccessibleChat) => ReactNode;
  sharedFoldersByOwner: Array<[string, AccessibleChatFolder[]]>;
  t: I18nContextValue["t"];
};

type SidebarFolderRowProps = {
  folder: AccessibleChatFolder;
  folderChats: AccessibleChat[];
  folderMenuDisabled: boolean;
  onDeleteFolder?: () => void;
  onManageFolderSharing?: () => void;
  onRenameFolder?: () => void;
  onShareFolder?: () => void;
  onToggleFolderCollapsed: () => void;
  renderChatRow: (chat: AccessibleChat) => ReactNode;
  shared: boolean;
  t: I18nContextValue["t"];
};

function getSharedFolderOwnerGroupId(ownerName: string) {
  return `folders:shared-from:${ownerName}`;
}

function getSidebarFolderTestId(folderId: string, shared: boolean) {
  return shared
    ? `sidebar:shared-folder:${folderId}`
    : `sidebar:folder:${folderId}`;
}

function getSidebarFolderChats(
  chats: AccessibleChat[],
  folderId: string
) {
  return chats
    .filter((chat) => !chat.archivedAt && chat.folderId === folderId)
    .sort(compareChatsForSidebar);
}

function SidebarFolderRow({
  folder,
  folderChats,
  folderMenuDisabled,
  onDeleteFolder,
  onManageFolderSharing,
  onRenameFolder,
  onShareFolder,
  onToggleFolderCollapsed,
  renderChatRow,
  shared,
  t,
}: SidebarFolderRowProps) {
  return (
    <div className="space-y-1">
      <div
        className={
          "group flex items-center gap-1 rounded-md transition-colors hover:bg-sidebar-accent/70"
        }
        data-testid={getSidebarFolderTestId(folder.id, shared)}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
          data-testid={`sidebar:folder-toggle:${folder.id}`}
          onClick={onToggleFolderCollapsed}
          type="button"
        >
          <div className="relative size-4 shrink-0 text-muted-foreground">
            {folder.collapsed ? (
              <FolderIcon className="size-4" />
            ) : (
              <FolderOpenIcon className="size-4" />
            )}
            {shared || (folder.sharedWithCount ?? 0) > 0 ? (
              <UsersIcon className="absolute -bottom-1 -right-1 size-3" />
            ) : null}
          </div>
          <div className="truncate">{folder.name}</div>
          <div className="ml-auto text-sm text-muted-foreground">
            {folderChats.length}
          </div>
        </button>

        {!shared ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-9 w-9 shrink-0 px-0 opacity-60 transition-opacity group-hover:opacity-100"
                data-testid={`sidebar:folder-menu:${folder.id}`}
                disabled={folderMenuDisabled}
                suppressHydrationWarning
                type="button"
                variant="outline"
              >
                <MoreVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid={`folder-action:share:${folder.id}`}
                onClick={onShareFolder}
              >
                <UsersIcon />
                {t("folder.share")}
              </DropdownMenuItem>
              {(folder.sharedWithCount ?? 0) > 0 ? (
                <DropdownMenuItem
                  data-testid={`folder-action:manage-sharing:${folder.id}`}
                  onClick={onManageFolderSharing}
                >
                  <UsersIcon />
                  {t("folder.manage_sharing")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid={`folder-action:rename:${folder.id}`}
                onClick={onRenameFolder}
              >
                <PencilIcon />
                {t("common.rename")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid={`folder-action:delete:${folder.id}`}
                onClick={onDeleteFolder}
                variant="destructive"
              >
                <Trash2Icon />
                {t("folder.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {!folder.collapsed ? (
        <div className="space-y-1 pl-6">{folderChats.map(renderChatRow)}</div>
      ) : null}
    </div>
  );
}

export function HomeClientSidebarFolders({
  chats,
  folderActionsDisabled,
  folderGroupCollapsed,
  onDeleteFolder,
  onManageFolderSharing,
  onRenameFolder,
  onSetFolderGroupCollapsedValue,
  onShareFolder,
  onToggleFolderCollapsed,
  ownedFolders,
  renderChatRow,
  sharedFoldersByOwner,
  t,
}: HomeClientSidebarFoldersProps) {
  const hasSharedFolders = sharedFoldersByOwner.length > 0;

  return (
    <>
      <div className="space-y-1" data-testid="sidebar:folders">
        {hasSharedFolders ? (
          <button
            aria-expanded={!folderGroupCollapsed["folders:personal"]}
            className="flex w-full items-center gap-2 px-3 text-left text-sm font-medium text-muted-foreground"
            data-testid="sidebar:folders-personal-toggle"
            onClick={() =>
              onSetFolderGroupCollapsedValue(
                "folders:personal",
                !folderGroupCollapsed["folders:personal"]
              )
            }
            type="button"
          >
            {folderGroupCollapsed["folders:personal"] ? (
              <FolderIcon className="size-4 shrink-0" />
            ) : (
              <FolderOpenIcon className="size-4 shrink-0" />
            )}
            <span>{t("sidebar.personal_folders")}</span>
          </button>
        ) : null}

        {hasSharedFolders && folderGroupCollapsed["folders:personal"] ? null : (
          <div className={hasSharedFolders ? "pl-6" : ""}>
            {ownedFolders.map((folder) => (
              <SidebarFolderRow
                folder={folder}
                folderChats={getSidebarFolderChats(chats, folder.id)}
                folderMenuDisabled={folderActionsDisabled(folder)}
                key={folder.id}
                onDeleteFolder={() => onDeleteFolder(folder.id)}
                onManageFolderSharing={() => onManageFolderSharing(folder.id)}
                onRenameFolder={() => onRenameFolder(folder.id)}
                onShareFolder={() => onShareFolder(folder.id)}
                onToggleFolderCollapsed={() =>
                  onToggleFolderCollapsed(folder.id, !folder.collapsed)
                }
                renderChatRow={renderChatRow}
                shared={false}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {hasSharedFolders ? (
        <div className="space-y-2 pt-2" data-testid="sidebar:folders-shared">
          <button
            aria-expanded={!folderGroupCollapsed["folders:shared"]}
            className="flex w-full items-center gap-2 px-3 text-left text-sm font-medium text-muted-foreground"
            data-testid="sidebar:folders-shared-toggle"
            onClick={() =>
              onSetFolderGroupCollapsedValue(
                "folders:shared",
                !folderGroupCollapsed["folders:shared"]
              )
            }
            type="button"
          >
            {folderGroupCollapsed["folders:shared"] ? (
              <FolderIcon className="size-4 shrink-0" />
            ) : (
              <FolderOpenIcon className="size-4 shrink-0" />
            )}
            <span>{t("sidebar.shared_with_me")}</span>
          </button>

          {folderGroupCollapsed["folders:shared"]
            ? null
            : sharedFoldersByOwner.map(([ownerName, ownerFolders]) => {
                const ownerGroupId = getSharedFolderOwnerGroupId(ownerName);
                const ownerGroupCollapsed = Boolean(
                  folderGroupCollapsed[ownerGroupId]
                );

                return (
                  <div className="space-y-1 pl-6" key={ownerName}>
                    <button
                      aria-expanded={!ownerGroupCollapsed}
                      className="flex w-full items-center gap-2 px-3 pt-1 text-left text-sm font-medium text-muted-foreground"
                      onClick={() =>
                        onSetFolderGroupCollapsedValue(
                          ownerGroupId,
                          !ownerGroupCollapsed
                        )
                      }
                      type="button"
                    >
                      {ownerGroupCollapsed ? (
                        <FolderIcon className="size-4 shrink-0" />
                      ) : (
                        <FolderOpenIcon className="size-4 shrink-0" />
                      )}
                      <span>{t("sidebar.shared_by", { ownerName })}</span>
                    </button>

                    {ownerGroupCollapsed
                      ? null
                      : ownerFolders.map((folder) => (
                          <SidebarFolderRow
                            folder={folder}
                            folderChats={getSidebarFolderChats(chats, folder.id)}
                            folderMenuDisabled={true}
                            key={folder.id}
                            onToggleFolderCollapsed={() =>
                              onToggleFolderCollapsed(folder.id, !folder.collapsed)
                            }
                            renderChatRow={renderChatRow}
                            shared
                            t={t}
                          />
                        ))}
                  </div>
                );
              })}
        </div>
      ) : null}
    </>
  );
}
