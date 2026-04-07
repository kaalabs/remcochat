"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { Profile } from "@/domain/profiles/types";

import {
  useHomeClientCreateProfile,
} from "@/app/home-client-create-profile";
import {
  useHomeClientFolderActions,
} from "@/app/home-client-folder-actions";
import {
  useHomeClientMemorizeActions,
} from "@/app/home-client-temporary-mode";
import {
  useHomeClientPageController,
} from "@/app/home-client-page-controller";
import {
  useHomeClientProfileControllers,
} from "@/app/home-client-profile-controllers";
import {
  useHomeClientProfileSettings,
} from "@/app/home-client-profile-settings";
import {
  useHomeClientChatControllers,
} from "@/app/home-client-chat-controllers";
import type { useHomeClientAppState } from "@/app/home-client-app-state";

type UseHomeClientShellControllersInput = {
  appState: ReturnType<typeof useHomeClientAppState>;
  chatControllers: ReturnType<typeof useHomeClientChatControllers>;
  profileControllers: ReturnType<typeof useHomeClientProfileControllers>;
  setDesktopSidebarCollapsed: (collapsed: boolean) => void;
  setUiLanguage: I18nContextValue["setUiLanguage"];
  t: I18nContextValue["t"];
  uiLanguage: Profile["uiLanguage"];
};

export function useHomeClientShellControllers({
  appState,
  chatControllers,
  profileControllers,
  setDesktopSidebarCollapsed,
  setUiLanguage,
  t,
  uiLanguage,
}: UseHomeClientShellControllersInput) {
  const folderActions = useHomeClientFolderActions({
    activeProfileId:
      profileControllers.profileSelection.activeProfile?.id ?? "",
    folders: appState.folders,
    refreshFolders: chatControllers.chatBootstrap.refreshFolders,
    setChats: appState.setChats,
    setFolders: appState.setFolders,
    statusReady: chatControllers.chatSession.status === "ready",
    t,
  });

  const createProfileController = useHomeClientCreateProfile({
    applyCreatedProfile: profileControllers.profileLifecycle.applyCreatedProfile,
    profileDefaultModelId: chatControllers.modelSelection.profileDefaultModelId,
    t,
    uiLanguage,
  });

  const profileSettingsController = useHomeClientProfileSettings({
    activeProfile: profileControllers.profileSelection.activeProfile,
    refreshProfiles: profileControllers.profileLifecycle.refreshProfiles,
    setProfiles: appState.setProfiles,
    setUiLanguage,
    statusReady: chatControllers.chatSession.status === "ready",
    t,
  });

  const memorizeController = useHomeClientMemorizeActions({
    activeProfile: profileControllers.profileSelection.activeProfile,
    addMemoryItem: profileSettingsController.addMemoryItem,
    isTemporaryChat: chatControllers.isTemporaryChat,
    t,
  });

  const pageController = useHomeClientPageController({
    activeProfile: profileControllers.profileSelection.activeProfile,
    effectiveModelId: chatControllers.modelSelection.effectiveModelId,
    error: chatControllers.chatSession.error,
    isTemporaryChat: chatControllers.isTemporaryChat,
    messages: chatControllers.chatSession.messages,
    openCreateProfile: createProfileController.openCreateProfile,
    profileSettings: profileSettingsController.profileSettings,
    refreshChats: chatControllers.chatBootstrap.refreshChats,
    refreshFolders: chatControllers.chatBootstrap.refreshFolders,
    resetCurrentChatState: chatControllers.chatStateSync.resetCurrentChatState,
    setActiveChatId: appState.setActiveChatId,
    setDesktopSidebarCollapsed,
    setFolderError: folderActions.setFolderError,
    setIsTemporaryChat: chatControllers.temporaryMode.setActive,
    stop: chatControllers.chatSession.stop,
    t,
    toggleTemporaryMode: chatControllers.temporaryMode.toggle,
    uiLanguage,
  });

  return {
    createProfileController,
    folderActions,
    memorizeController,
    pageController,
    profileSettingsController,
  };
}
