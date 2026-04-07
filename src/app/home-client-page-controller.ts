"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import type { UIMessage } from "ai";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { Profile } from "@/domain/profiles/types";
import { requestFocusComposer } from "@/app/home-client-ui-effects";
import {
  readOpeningMessageCache,
  selectOpeningMessageFromCache,
  storeOpeningMessageNext,
  writeOpeningMessageCache,
} from "@/lib/opening-message-cache";

type RefreshChatsInput = {
  ensureAtLeastOne?: boolean;
  profileId: string;
};

type UseHomeClientPageControllerInput = {
  activeProfile: Profile | null;
  effectiveModelId: string;
  error: unknown;
  isTemporaryChat: boolean;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  openCreateProfile: () => void;
  profileSettings: {
    setOpen: Dispatch<SetStateAction<boolean>>;
  };
  refreshChats: (input: RefreshChatsInput) => Promise<void>;
  refreshFolders: (profileId: string) => Promise<void>;
  resetCurrentChatState: () => void;
  setActiveChatId: Dispatch<SetStateAction<string>>;
  setDesktopSidebarCollapsed: (collapsed: boolean) => void;
  setFolderError: Dispatch<SetStateAction<string | null>>;
  setIsTemporaryChat: Dispatch<SetStateAction<boolean>>;
  stop: () => void;
  t: I18nContextValue["t"];
  toggleTemporaryMode: (input: {
    currentModelId: string;
    resetCurrentChatState: () => void;
  }) => void;
  uiLanguage: Profile["uiLanguage"];
};

export function buildHomeClientOpeningMessagePrefetchSearchParams(input: {
  displayed: string;
  nextQueued: string;
  uiLanguage: Profile["uiLanguage"];
}) {
  const params = new URLSearchParams({ lang: input.uiLanguage });
  const exclude = [input.displayed, input.nextQueued]
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);

  if (exclude.length > 0) {
    params.set("exclude", exclude.join(","));
  }

  return params;
}

export function isHomeClientInaccessibleChatError(error: unknown) {
  const message = String(
    (error as { message?: unknown } | null)?.message ?? error ?? ""
  )
    .trim()
    .toLowerCase();

  return message.includes("not accessible");
}

function queueHomeClientComposerFocus(
  focusComposer: (opts?: { toEnd?: boolean }) => void
) {
  window.setTimeout(() => focusComposer({ toEnd: true }), 0);
}

export function useHomeClientPageController({
  activeProfile,
  effectiveModelId,
  error,
  isTemporaryChat,
  messages,
  openCreateProfile,
  profileSettings,
  refreshChats,
  refreshFolders,
  resetCurrentChatState,
  setActiveChatId,
  setDesktopSidebarCollapsed,
  setFolderError,
  setIsTemporaryChat,
  stop,
  t,
  toggleTemporaryMode,
  uiLanguage,
}: UseHomeClientPageControllerInput) {
  const [profileSelectOpen, setProfileSelectOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openingMessage, setOpeningMessage] = useState(() =>
    t("home.empty.start_chat")
  );

  const focusComposer = useCallback((opts?: { toEnd?: boolean }) => {
    requestFocusComposer(opts);
  }, []);

  useEffect(() => {
    if (!activeProfile) return;

    refreshChats({ profileId: activeProfile.id, ensureAtLeastOne: true }).catch(
      () => {}
    );
    refreshFolders(activeProfile.id).catch(() => {});
  }, [activeProfile, refreshChats, refreshFolders]);

  const openingMessageFallback = t("home.empty.start_chat");

  useEffect(() => {
    if (messages.length !== 0) {
      setOpeningMessage(openingMessageFallback);
      return;
    }

    const openingMessageSelection = selectOpeningMessageFromCache({
      cache: readOpeningMessageCache(uiLanguage),
      fallback: openingMessageFallback,
    });
    setOpeningMessage(openingMessageSelection.displayed);
    writeOpeningMessageCache(uiLanguage, openingMessageSelection.nextCache);

    const params = buildHomeClientOpeningMessagePrefetchSearchParams({
      displayed: openingMessageSelection.displayed,
      nextQueued: openingMessageSelection.nextCache.next,
      uiLanguage,
    });

    let canceled = false;

    fetch(`/api/chat/opening-message?${params.toString()}`, {
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) return null;
        return response.json().catch(() => null) as Promise<
          { message?: unknown } | null
        >;
      })
      .then((data) => {
        if (canceled) return;
        const nextMessage = String(data?.message ?? "").trim();
        if (!nextMessage) return;

        storeOpeningMessageNext(uiLanguage, {
          displayed: openingMessageSelection.displayed,
          next: nextMessage,
          fallback: openingMessageFallback,
        });
      })
      .catch(() => {});

    return () => {
      canceled = true;
    };
  }, [messages.length, openingMessageFallback, uiLanguage]);

  useEffect(() => {
    if (!activeProfile) return;
    if (isTemporaryChat) return;
    if (!isHomeClientInaccessibleChatError(error)) return;

    stop();
    setFolderError("This chat is no longer shared with this profile.");
    refreshFolders(activeProfile.id).catch(() => {});
    refreshChats({ profileId: activeProfile.id, ensureAtLeastOne: true }).catch(
      () => {}
    );
  }, [
    activeProfile,
    error,
    isTemporaryChat,
    refreshChats,
    refreshFolders,
    setFolderError,
    stop,
  ]);

  const toggleTemporaryChat = useCallback(() => {
    toggleTemporaryMode({
      currentModelId: effectiveModelId,
      resetCurrentChatState,
    });
  }, [effectiveModelId, resetCurrentChatState, toggleTemporaryMode]);

  const closeSidebarDrawer = useCallback(() => {
    setSidebarOpen(false);
    queueHomeClientComposerFocus(focusComposer);
  }, [focusComposer]);

  const setDesktopSidebarCollapsedWithComposerFocus = useCallback(
    (collapsed: boolean) => {
      setDesktopSidebarCollapsed(collapsed);
      queueHomeClientComposerFocus(focusComposer);
    },
    [focusComposer, setDesktopSidebarCollapsed]
  );

  const handleSidebarDrawerOpenChange = useCallback(
    (open: boolean) => {
      setSidebarOpen(open);
      if (open) return;
      queueHomeClientComposerFocus(focusComposer);
    },
    [focusComposer]
  );

  const handleSidebarProfileSelectOpenChange = useCallback(
    (open: boolean) => {
      setProfileSelectOpen(open);
      if (open) return;
      queueHomeClientComposerFocus(focusComposer);
    },
    [focusComposer]
  );

  const openCreateProfileFromSidebar = useCallback(() => {
    openCreateProfile();
  }, [openCreateProfile]);

  const openProfileSettingsFromSidebar = useCallback(() => {
    profileSettings.setOpen(true);
  }, [profileSettings]);

  const openSidebarDrawer = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const selectPersistedSidebarChat = useCallback(
    (chatId: string) => {
      if (!activeProfile) return;
      setIsTemporaryChat(false);
      setActiveChatId(chatId);
    },
    [activeProfile, setActiveChatId, setIsTemporaryChat]
  );

  return {
    closeSidebarDrawer,
    focusComposer,
    handleSidebarDrawerOpenChange,
    handleSidebarProfileSelectOpenChange,
    openCreateProfileFromSidebar,
    openProfileSettingsFromSidebar,
    openSidebarDrawer,
    openingMessage,
    profileSelectOpen,
    selectPersistedSidebarChat,
    setDesktopSidebarCollapsedWithComposerFocus,
    sidebarOpen,
    toggleTemporaryChat,
  };
}
