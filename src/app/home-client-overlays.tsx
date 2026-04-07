"use client";

import type { ComponentProps, ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { I18nContextValue } from "@/components/i18n-provider";
import {
  HomeClientChatSettingsDialog,
  HomeClientEditForkDialog,
  HomeClientMemorizeDialog,
  HomeClientRenameChatDialog,
} from "@/app/home-client-chat-dialogs";
import {
  HomeClientCreateProfileDialog,
  HomeClientDeleteProfileDialog,
  HomeClientProfileSettingsDialog,
} from "@/app/home-client-profile-dialogs";
import { HomeClientFolderDialogs } from "@/app/home-client-folder-dialogs";
import { HomeClientLanAdminDialog } from "@/app/home-client-lan-admin-ui";

type HomeClientOverlaysProps = {
  chatSettingsDialog: ComponentProps<typeof HomeClientChatSettingsDialog>;
  createProfileDialog: ComponentProps<typeof HomeClientCreateProfileDialog>;
  deleteProfileDialog: ComponentProps<typeof HomeClientDeleteProfileDialog>;
  drawerContent: ReactNode;
  drawerOpen: boolean;
  editForkDialog: ComponentProps<typeof HomeClientEditForkDialog>;
  folderDialogs: ComponentProps<typeof HomeClientFolderDialogs>;
  lanAdminDialog: ComponentProps<typeof HomeClientLanAdminDialog>;
  memorizeDialog: ComponentProps<typeof HomeClientMemorizeDialog>;
  onDrawerOpenChange: (open: boolean) => void;
  profileSettingsDialog: ComponentProps<typeof HomeClientProfileSettingsDialog>;
  renameChatDialog: ComponentProps<typeof HomeClientRenameChatDialog>;
  t: I18nContextValue["t"];
};

export function HomeClientOverlays({
  chatSettingsDialog,
  createProfileDialog,
  deleteProfileDialog,
  drawerContent,
  drawerOpen,
  editForkDialog,
  folderDialogs,
  lanAdminDialog,
  memorizeDialog,
  onDrawerOpenChange,
  profileSettingsDialog,
  renameChatDialog,
  t,
}: HomeClientOverlaysProps) {
  return (
    <>
      <Dialog onOpenChange={onDrawerOpenChange} open={drawerOpen}>
        <DialogContent
          className="rc-mobile-drawer left-0 top-0 flex h-dvh min-w-0 w-[85vw] max-w-[18rem] flex-col translate-x-0 translate-y-0 gap-0 overflow-x-hidden rounded-none border-0 border-r p-0 data-[state=closed]:slide-out-to-left-2 data-[state=open]:slide-in-from-left-2 md:hidden"
          data-testid="sidebar:drawer"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {t("sidebar.menu.sr_title")}
          </DialogTitle>
          {drawerContent}
        </DialogContent>
      </Dialog>

      <HomeClientCreateProfileDialog {...createProfileDialog} />
      <HomeClientEditForkDialog {...editForkDialog} />
      <HomeClientProfileSettingsDialog {...profileSettingsDialog} />
      <HomeClientDeleteProfileDialog {...deleteProfileDialog} />
      <HomeClientChatSettingsDialog {...chatSettingsDialog} />
      <HomeClientLanAdminDialog {...lanAdminDialog} />
      <HomeClientRenameChatDialog {...renameChatDialog} />
      <HomeClientFolderDialogs {...folderDialogs} />
      <HomeClientMemorizeDialog {...memorizeDialog} />
    </>
  );
}
