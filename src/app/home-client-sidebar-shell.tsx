"use client";

import {
  forwardRef,
  type ComponentPropsWithoutRef,
} from "react";
import Image from "next/image";

import type { I18nContextValue } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import {
  ChevronDownIcon,
  FolderPlusIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";

type HomeClientSidebarShellHeaderProps = {
  desktopSidebarCollapsed: boolean;
  mode: "desktop" | "drawer";
  onCloseDrawer: () => void;
  onCollapseDesktop: () => void;
  t: I18nContextValue["t"];
};

type HomeClientSidebarToolbarProps = {
  activeProfileAvailable: boolean;
  deleteChatError: string | null;
  folderError: string | null;
  onCreateChat: () => void;
  onCreateFolder: () => void;
  statusReady: boolean;
  t: I18nContextValue["t"];
};

type HomeClientSidebarArchivedTriggerProps = ComponentPropsWithoutRef<"button"> & {
  count: number;
  open: boolean;
  t: I18nContextValue["t"];
};

export function HomeClientSidebarShellHeader({
  desktopSidebarCollapsed,
  mode,
  onCloseDrawer,
  onCollapseDesktop,
  t,
}: HomeClientSidebarShellHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Image
          alt=""
          aria-hidden="true"
          className="h-6 w-6 shrink-0"
          src="/icons/remcochat-sidebar-mark.png"
          height={24}
          width={24}
        />
        <div className="min-w-0 truncate font-semibold tracking-tight">
          RemcoChat
        </div>
      </div>

      {mode === "drawer" ? (
        <DialogClose asChild>
          <Button
            aria-label={t("sidebar.close_menu.aria")}
            className="h-9 w-9"
            onClick={onCloseDrawer}
            size="icon"
            type="button"
            variant="outline"
          >
            <XIcon className="size-4" />
          </Button>
        </DialogClose>
      ) : (
        <div className="hidden items-center gap-1 md:flex">
          <Button
            aria-label={t("sidebar.collapse.aria")}
            aria-pressed={!desktopSidebarCollapsed}
            className="h-9 w-9"
            data-testid="sidebar:desktop-toggle"
            onClick={onCollapseDesktop}
            title={t("sidebar.collapse.aria")}
            type="button"
            variant="outline"
          >
            <PanelLeftCloseIcon className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function HomeClientSidebarToolbar({
  activeProfileAvailable,
  deleteChatError,
  folderError,
  onCreateChat,
  onCreateFolder,
  statusReady,
  t,
}: HomeClientSidebarToolbarProps) {
  const actionsDisabled = !activeProfileAvailable || !statusReady;

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <div className="text-sm font-medium text-muted-foreground">
          {t("sidebar.chats")}
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label={t("sidebar.new_folder.aria")}
            className="h-9 w-9 px-0"
            data-testid="sidebar:new-folder"
            disabled={actionsDisabled}
            onClick={onCreateFolder}
            title={t("sidebar.new_folder.title")}
            type="button"
            variant="outline"
          >
            <FolderPlusIcon className="size-4" />
          </Button>
          <Button
            aria-label={t("sidebar.new_chat.aria")}
            className="h-9 w-9 px-0"
            data-testid="sidebar:new-chat"
            disabled={actionsDisabled}
            onClick={onCreateChat}
            title={t("sidebar.new_chat.title")}
            type="button"
            variant="outline"
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </div>

      {deleteChatError ? (
        <div className="px-2 pb-2 text-sm text-destructive">
          {deleteChatError}
        </div>
      ) : null}
      {folderError ? (
        <div className="px-2 pb-2 text-sm text-destructive">{folderError}</div>
      ) : null}
    </>
  );
}

export const HomeClientSidebarArchivedTrigger = forwardRef<
  HTMLButtonElement,
  HomeClientSidebarArchivedTriggerProps
>(function HomeClientSidebarArchivedTrigger(
  { count, open, t, className, type = "button", ...buttonProps },
  ref
) {
  return (
    <button
      {...buttonProps}
      className={[
        "flex w-full items-center justify-between gap-2 px-3 pb-1 text-left text-sm font-medium text-muted-foreground",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="sidebar:archived-toggle"
      ref={ref}
      suppressHydrationWarning
      type={type}
    >
      <span>{t("sidebar.archived", { count })}</span>
      <ChevronDownIcon
        className={"size-3 transition-transform " + (open ? "rotate-180" : "")}
      />
    </button>
  );
});
