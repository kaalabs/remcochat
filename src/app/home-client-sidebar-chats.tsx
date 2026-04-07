"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AccessibleChat } from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";
import {
  ArchiveIcon,
  DownloadIcon,
  FolderIcon,
  MoreVerticalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

import { chatIsPinned } from "@/app/home-client-chat-actions";

type HomeClientSidebarChatRowProps = {
  actionsDisabled: boolean;
  active: boolean;
  archived?: boolean;
  chat: AccessibleChat;
  onArchive?: () => void;
  onDelete: () => void;
  onExport: (format: "json" | "md") => void;
  onMoveToFolder: (folderId: string | null) => void;
  onRename: () => void;
  onSelect: () => void;
  onTogglePin?: () => void;
  onUnarchive?: () => void;
  ownedFolders: AccessibleChatFolder[];
  pinDisabled: boolean;
  t: I18nContextValue["t"];
};

export function HomeClientSidebarChatRow({
  actionsDisabled,
  active,
  archived = false,
  chat,
  onArchive,
  onDelete,
  onExport,
  onMoveToFolder,
  onRename,
  onSelect,
  onTogglePin,
  onUnarchive,
  ownedFolders,
  pinDisabled,
  t,
}: HomeClientSidebarChatRowProps) {
  const pinned = chatIsPinned(chat);

  return (
    <div
      className={
        "group flex items-center gap-1 rounded-md transition-colors " +
        (active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "")
      }
    >
      <button
        className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
        data-testid={
          archived
            ? `sidebar:archived-chat:${chat.id}`
            : `sidebar:chat:${chat.id}`
        }
        onClick={onSelect}
        type="button"
      >
        <div className="truncate">
          {chat.title.trim() ? chat.title : t("chat.untitled")}
        </div>
      </button>

      {!archived ? (
        <Button
          aria-label={pinned ? t("chat.unpin.aria") : t("chat.pin.aria")}
          aria-pressed={pinned}
          className={
            "h-9 w-9 shrink-0 px-0 transition-opacity " +
            (pinned
              ? "opacity-100"
              : "opacity-50 hover:opacity-100 focus-visible:opacity-100")
          }
          data-testid={`sidebar:chat-pin:${chat.id}`}
          disabled={pinDisabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onTogglePin?.();
          }}
          suppressHydrationWarning
          type="button"
          variant="ghost"
        >
          {pinned ? (
            <PinIcon className="size-4 text-sidebar-primary" />
          ) : (
            <PinOffIcon className="size-4 text-muted-foreground" />
          )}
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="h-9 w-9 shrink-0 px-0 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
            data-testid={
              archived
                ? `sidebar:archived-chat-menu:${chat.id}`
                : `sidebar:chat-menu:${chat.id}`
            }
            disabled={actionsDisabled}
            suppressHydrationWarning
            type="button"
            variant="ghost"
          >
            <MoreVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {archived ? (
            <DropdownMenuItem
              data-testid={`chat-action:unarchive:${chat.id}`}
              onClick={onUnarchive}
            >
              <Undo2Icon />
              {t("chat.unarchive")}
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              data-testid={`chat-action:move-folder:${chat.id}`}
            >
              <FolderIcon />
              {t("chat.move_to_folder")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={(value) => {
                  onMoveToFolder(value || null);
                }}
                value={chat.folderId ?? ""}
              >
                <DropdownMenuRadioItem value="">
                  {t("chat.no_folder")}
                </DropdownMenuRadioItem>
                {ownedFolders.map((folder) => (
                  <DropdownMenuRadioItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {archived ? null : <DropdownMenuSeparator />}
          {!archived ? (
            <DropdownMenuItem
              data-testid={`chat-action:archive:${chat.id}`}
              onClick={onArchive}
            >
              <ArchiveIcon />
              {t("chat.archive")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            data-testid={`chat-action:rename:${chat.id}`}
            onClick={onRename}
          >
            <PencilIcon />
            {t("common.rename")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid={`chat-action:export-md:${chat.id}`}
            onClick={() => onExport("md")}
          >
            <DownloadIcon />
            {t("chat.export.markdown")}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid={`chat-action:export-json:${chat.id}`}
            onClick={() => onExport("json")}
          >
            <DownloadIcon />
            {t("chat.export.json")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid={`chat-action:delete:${chat.id}`}
            onClick={onDelete}
            variant="destructive"
          >
            <Trash2Icon />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
