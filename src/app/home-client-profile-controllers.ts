"use client";

import type {
  Dispatch,
  SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { Profile } from "@/domain/profiles/types";

import {
  useFolderSidebarGroups,
} from "@/app/home-client-folders";
import {
  useHomeClientProfileLifecycle,
} from "@/app/home-client-profile-lifecycle";
import {
  useHomeClientProfileSelection,
} from "@/app/home-client-profile-selection";
import type { useHomeClientAppState } from "@/app/home-client-app-state";

type UseHomeClientProfileControllersInput = {
  appState: ReturnType<typeof useHomeClientAppState>;
  initialActiveProfileId: string;
  initialProfiles: Profile[];
  isTemporaryChat: boolean;
  setIsTemporaryChat: Dispatch<SetStateAction<boolean>>;
  setUiLanguage: I18nContextValue["setUiLanguage"];
  uiLanguage: Profile["uiLanguage"];
};

export function useHomeClientProfileControllers({
  appState,
  initialActiveProfileId,
  initialProfiles,
  isTemporaryChat,
  setIsTemporaryChat,
  setUiLanguage,
  uiLanguage,
}: UseHomeClientProfileControllersInput) {
  const profileSelection = useHomeClientProfileSelection({
    activeChatId: appState.activeChatId,
    chats: appState.chats,
    initialActiveProfileId,
    initialProfiles,
    isTemporaryChat,
    profiles: appState.profiles,
    setActiveChatId: appState.setActiveChatId,
    setChats: appState.setChats,
    setIsTemporaryChat,
    setUiLanguage,
    setVariantsByUserMessageId: appState.setVariantsByUserMessageId,
    uiLanguage,
  });

  const profileLifecycle = useHomeClientProfileLifecycle({
    setActiveChatId: appState.setActiveChatId,
    setActiveProfileId: profileSelection.setActiveProfileId,
    setChats: appState.setChats,
    setFolders: appState.setFolders,
    setIsTemporaryChat,
    setProfiles: appState.setProfiles,
  });

  const folderSidebarGroups = useFolderSidebarGroups({
    activeProfileId: profileSelection.activeProfileId,
    folders: appState.folders,
  });

  return {
    folderSidebarGroups,
    profileLifecycle,
    profileSelection,
  };
}
