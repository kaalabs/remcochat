"use client";

import type { ReactNode } from "react";

import type { AccessibleChat } from "@/domain/chats/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  HomeClientSidebarArchivedTrigger,
} from "@/app/home-client-sidebar-shell";
import type { I18nContextValue } from "@/components/i18n-provider";

type HomeClientSidebarChatListsProps = {
  archivedChats: AccessibleChat[];
  archivedOpen: boolean;
  onArchivedOpenChange: (open: boolean) => void;
  renderArchivedChatRow: (chat: AccessibleChat) => ReactNode;
  renderRootChatRow: (chat: AccessibleChat) => ReactNode;
  rootChats: AccessibleChat[];
  showFoldersSeparator: boolean;
  t: I18nContextValue["t"];
};

export function shouldRenderSidebarArchivedSection(archivedChatCount: number) {
  return archivedChatCount > 0;
}

export function HomeClientSidebarChatLists({
  archivedChats,
  archivedOpen,
  onArchivedOpenChange,
  renderArchivedChatRow,
  renderRootChatRow,
  rootChats,
  showFoldersSeparator,
  t,
}: HomeClientSidebarChatListsProps) {
  return (
    <>
      {showFoldersSeparator ? (
        <div
          aria-hidden="true"
          data-testid="sidebar:folders-separator"
          className="py-2"
        >
          <div className="h-[2px] w-full rounded-full bg-black/20 dark:bg-white/20" />
        </div>
      ) : null}

      {rootChats.map(renderRootChatRow)}

      {shouldRenderSidebarArchivedSection(archivedChats.length) ? (
        <div className="pt-2">
          <Collapsible onOpenChange={onArchivedOpenChange} open={archivedOpen}>
            <CollapsibleTrigger asChild>
              <HomeClientSidebarArchivedTrigger
                count={archivedChats.length}
                open={archivedOpen}
                t={t}
              />
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div
                className="space-y-1 px-1 pb-2"
                data-testid="sidebar:chats-archived"
              >
                {archivedChats.map(renderArchivedChatRow)}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
    </>
  );
}
