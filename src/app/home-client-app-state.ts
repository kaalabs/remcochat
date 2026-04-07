"use client";

import type { UIMessage } from "ai";
import { useMemo, useRef, useState } from "react";

import type {
  AccessibleChat,
  RemcoChatMessageMetadata,
} from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";
import type { Profile } from "@/domain/profiles/types";
import {
  type HomeClientChatSyncState,
  type HomeClientPreloadedChatState,
} from "@/app/home-client-chat-state-sync";
import {
  useHomeClientTemporaryModeState,
} from "@/app/home-client-temporary-mode";

type VariantsByUserMessageId = Record<
  string,
  UIMessage<RemcoChatMessageMetadata>[]
>;

type UseHomeClientAppStateInput = {
  initialActiveProfileId: string;
  initialChats: AccessibleChat[];
  initialProfiles: Profile[];
};

export function resolveInitialHomeClientProfileId(input: {
  initialActiveProfileId: string;
  initialProfiles: Profile[];
}): string {
  return input.initialProfiles.some(
    (profile) => profile.id === input.initialActiveProfileId
  )
    ? input.initialActiveProfileId
    : input.initialProfiles[0]?.id ?? "";
}

export function resolveInitialHomeClientProfileDefaultModelId(input: {
  initialActiveProfileId: string;
  initialProfiles: Profile[];
}): string {
  const initialProfileId = resolveInitialHomeClientProfileId(input);
  return (
    input.initialProfiles.find((profile) => profile.id === initialProfileId)
      ?.defaultModelId ??
    input.initialProfiles[0]?.defaultModelId ??
    ""
  );
}

export function resolveInitialHomeClientActiveChatId(
  initialChats: AccessibleChat[]
): string {
  return initialChats[0]?.id ?? "";
}

export function hasHomeClientArchivedChats(chats: AccessibleChat[]): boolean {
  return chats.some((chat) => Boolean(chat.archivedAt));
}

export function useHomeClientAppState({
  initialActiveProfileId,
  initialChats,
  initialProfiles,
}: UseHomeClientAppStateInput) {
  const initialProfileDefaultModelId =
    resolveInitialHomeClientProfileDefaultModelId({
      initialActiveProfileId,
      initialProfiles,
    });

  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [chats, setChats] = useState<AccessibleChat[]>(initialChats);
  const [folders, setFolders] = useState<AccessibleChatFolder[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>(
    resolveInitialHomeClientActiveChatId(initialChats)
  );
  const [variantsByUserMessageId, setVariantsByUserMessageId] = useState<
    VariantsByUserMessageId
  >({});
  const [archivedOpen, setArchivedOpen] = useState(false);

  const syncRef = useRef<HomeClientChatSyncState>(null);
  const loadedChatIdRef = useRef<string>("");
  const preloadedChatStateRef = useRef<HomeClientPreloadedChatState>(null);

  const temporaryMode = useHomeClientTemporaryModeState({
    initialProfileDefaultModelId,
  });

  const hasArchivedChats = useMemo(
    () => hasHomeClientArchivedChats(chats),
    [chats]
  );

  return {
    activeChatId,
    archivedOpen,
    chats,
    folders,
    hasArchivedChats,
    loadedChatIdRef,
    preloadedChatStateRef,
    profiles,
    setActiveChatId,
    setArchivedOpen,
    setChats,
    setFolders,
    setProfiles,
    setVariantsByUserMessageId,
    syncRef,
    temporaryMode,
    variantsByUserMessageId,
  };
}
