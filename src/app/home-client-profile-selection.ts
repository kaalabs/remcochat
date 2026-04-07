"use client";

import type { UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type {
  AccessibleChat,
  RemcoChatMessageMetadata,
} from "@/domain/chats/types";
import type { Profile } from "@/domain/profiles/types";
import {
  runHomeClientProfileReset,
} from "@/app/home-client-profile-reset";

const PROFILE_ID_STORAGE_KEY = "remcochat:profileId";

type VariantsByUserMessageId = Record<
  string,
  UIMessage<RemcoChatMessageMetadata>[]
>;

type UseHomeClientProfileSelectionInput = {
  activeChatId: string;
  chats: AccessibleChat[];
  initialActiveProfileId: string;
  initialProfiles: Profile[];
  isTemporaryChat: boolean;
  profiles: Profile[];
  setActiveChatId: Dispatch<SetStateAction<string>>;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  setIsTemporaryChat: Dispatch<SetStateAction<boolean>>;
  setUiLanguage: I18nContextValue["setUiLanguage"];
  setVariantsByUserMessageId: Dispatch<
    SetStateAction<VariantsByUserMessageId>
  >;
  uiLanguage: Profile["uiLanguage"];
};

export function resolveInitialActiveProfileId(input: {
  initialActiveProfileId: string;
  profiles: Profile[];
}): string {
  return input.profiles.some((profile) => profile.id === input.initialActiveProfileId)
    ? input.initialActiveProfileId
    : input.profiles[0]?.id ?? "";
}

export function resolveRestoredActiveProfileId(input: {
  activeProfileId: string;
  profiles: Profile[];
  storedProfileId: string;
}): string {
  if (!input.storedProfileId) return "";
  if (input.storedProfileId === input.activeProfileId) return "";
  return input.profiles.some((profile) => profile.id === input.storedProfileId)
    ? input.storedProfileId
    : "";
}

export function resolveActiveProfile(input: {
  activeProfileId: string;
  profiles: Profile[];
}): Profile | null {
  return (
    input.profiles.find((profile) => profile.id === input.activeProfileId) ??
    input.profiles[0] ??
    null
  );
}

export function resolveActiveChat(input: {
  activeChatId: string;
  chats: AccessibleChat[];
}): AccessibleChat | null {
  return input.chats.find((chat) => chat.id === input.activeChatId) ?? null;
}

export function resolveFallbackActiveChatId(input: {
  activeChat: AccessibleChat | null;
  activeChatId: string;
  chats: AccessibleChat[];
  isTemporaryChat: boolean;
}): string {
  if (input.isTemporaryChat) return input.activeChatId;
  if (input.activeChatId && input.activeChat) return input.activeChatId;
  return input.chats.find((chat) => !chat.archivedAt)?.id ?? "";
}

function persistActiveProfileId(activeProfileId: string) {
  if (!activeProfileId) return;
  window.localStorage.setItem(PROFILE_ID_STORAGE_KEY, activeProfileId);
  try {
    document.cookie = `remcochat_profile_id=${encodeURIComponent(
      activeProfileId
    )}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // ignore
  }
}

export function useHomeClientProfileSelection({
  activeChatId,
  chats,
  initialActiveProfileId,
  initialProfiles,
  isTemporaryChat,
  profiles,
  setActiveChatId,
  setChats,
  setIsTemporaryChat,
  setUiLanguage,
  setVariantsByUserMessageId,
  uiLanguage,
}: UseHomeClientProfileSelectionInput) {
  const initialProfileId = resolveInitialActiveProfileId({
    initialActiveProfileId,
    profiles: initialProfiles,
  });
  const [activeProfileId, setActiveProfileId] = useState(initialProfileId);

  const selectProfile = useCallback(
    (profileId: string) => {
      runHomeClientProfileReset({
        nextActiveProfileId: profileId,
        setActiveChatId,
        setActiveProfileId,
        setChats,
        setIsTemporaryChat,
        setVariantsByUserMessageId,
      });
    },
    [
      setActiveChatId,
      setActiveProfileId,
      setChats,
      setIsTemporaryChat,
      setVariantsByUserMessageId,
    ]
  );

  useEffect(() => {
    const storedProfileId =
      window.localStorage.getItem(PROFILE_ID_STORAGE_KEY) ?? "";
    const restoredProfileId = resolveRestoredActiveProfileId({
      activeProfileId: initialProfileId,
      profiles: initialProfiles,
      storedProfileId,
    });
    if (!restoredProfileId) return;
    selectProfile(restoredProfileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    persistActiveProfileId(activeProfileId);
  }, [activeProfileId]);

  const activeProfile = useMemo(
    () => resolveActiveProfile({ activeProfileId, profiles }),
    [activeProfileId, profiles]
  );

  useEffect(() => {
    if (!activeProfile) return;
    if (activeProfile.uiLanguage === uiLanguage) return;
    setUiLanguage(activeProfile.uiLanguage);
  }, [activeProfile, setUiLanguage, uiLanguage]);

  const activeChat = useMemo(
    () => resolveActiveChat({ activeChatId, chats }),
    [activeChatId, chats]
  );

  useEffect(() => {
    const fallbackActiveChatId = resolveFallbackActiveChatId({
      activeChat,
      activeChatId,
      chats,
      isTemporaryChat,
    });
    if (!fallbackActiveChatId) return;
    if (fallbackActiveChatId === activeChatId) return;
    setActiveChatId(fallbackActiveChatId);
  }, [activeChat, activeChatId, chats, isTemporaryChat, setActiveChatId]);

  return {
    activeChat,
    activeProfile,
    activeProfileId,
    selectProfile,
    setActiveProfileId,
  };
}
