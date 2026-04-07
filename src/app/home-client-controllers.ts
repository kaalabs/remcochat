"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { Profile } from "@/domain/profiles/types";

import {
  canManageHomeClientActiveChat,
  isHomeClientReasoningEnabled,
  useHomeClientChatControllers,
} from "@/app/home-client-chat-controllers";
import {
  useHomeClientProfileControllers,
} from "@/app/home-client-profile-controllers";
import {
  useHomeClientShellControllers,
} from "@/app/home-client-shell-controllers";
import type { useHomeClientAppState } from "@/app/home-client-app-state";

type UseHomeClientControllersInput = {
  appState: ReturnType<typeof useHomeClientAppState>;
  initialActiveProfileId: string;
  initialProfiles: Profile[];
  lanAdminAccessEnabled: boolean;
  queueScrollTranscriptToBottom: (
    animation: "instant" | "smooth"
  ) => void;
  scrollTranscriptToBottom: (
    animation?: "instant" | "smooth"
  ) => void;
  setDesktopSidebarCollapsed: (collapsed: boolean) => void;
  setUiLanguage: I18nContextValue["setUiLanguage"];
  t: I18nContextValue["t"];
  uiLanguage: Profile["uiLanguage"];
};
export { canManageHomeClientActiveChat, isHomeClientReasoningEnabled };

export function useHomeClientControllers({
  appState,
  initialActiveProfileId,
  initialProfiles,
  lanAdminAccessEnabled,
  queueScrollTranscriptToBottom,
  scrollTranscriptToBottom,
  setDesktopSidebarCollapsed,
  setUiLanguage,
  t,
  uiLanguage,
}: UseHomeClientControllersInput) {
  const profileControllers = useHomeClientProfileControllers({
    appState,
    initialActiveProfileId,
    initialProfiles,
    isTemporaryChat: appState.temporaryMode.active,
    setIsTemporaryChat: appState.temporaryMode.setActive,
    setUiLanguage,
    uiLanguage,
  });

  const chatControllers = useHomeClientChatControllers({
    appState,
    lanAdminAccessEnabled,
    profileSelection: profileControllers.profileSelection,
    queueScrollTranscriptToBottom,
    scrollTranscriptToBottom,
    t,
  });

  const shellControllers = useHomeClientShellControllers({
    appState,
    chatControllers,
    profileControllers,
    setDesktopSidebarCollapsed,
    setUiLanguage,
    t,
    uiLanguage,
  });

  return {
    chatControllers,
    profileControllers,
    shellControllers,
  };
}
