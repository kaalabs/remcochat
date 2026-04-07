"use client";

import type { UIMessage } from "ai";
import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type {
  AccessibleChat,
  RemcoChatMessageMetadata,
} from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";
import { sortChatsForSidebar } from "@/app/home-client-chat-actions";
import {
  signatureForChatState,
  type HomeClientChatSyncState,
  type HomeClientPreloadedChatState,
} from "@/app/home-client-chat-state-sync";

type RefreshChatsInput = {
  profileId: string;
  preferChatId?: string;
  ensureAtLeastOne?: boolean;
  seedFolderId?: string | null;
};

type ChatListResponse = {
  chats?: AccessibleChat[];
  error?: string;
};

type ChatMutationResponse = {
  chat?: AccessibleChat;
  error?: string;
};

type FolderListResponse =
  | { folders?: AccessibleChatFolder[]; error?: string }
  | null;

type UseHomeClientChatBootstrapInput = {
  activeProfileId: string;
  loadedChatIdRef: MutableRefObject<string>;
  preferredNewChatModelId: (profileId: string) => string;
  preloadedChatStateRef: MutableRefObject<HomeClientPreloadedChatState>;
  setActiveChatId: Dispatch<SetStateAction<string>>;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  setFolders: Dispatch<SetStateAction<AccessibleChatFolder[]>>;
  setIsTemporaryChat: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<
    SetStateAction<UIMessage<RemcoChatMessageMetadata>[]>
  >;
  setVariantsByUserMessageId: Dispatch<
    SetStateAction<
      Record<string, UIMessage<RemcoChatMessageMetadata>[]>
    >
  >;
  status: string;
  stop: () => void;
  syncRef: MutableRefObject<HomeClientChatSyncState>;
};

export function resolveRefreshedActiveChatId(input: {
  chats: AccessibleChat[];
  preferredChatId?: string;
  storedChatId?: string;
}): string {
  const preferredChatId =
    typeof input.preferredChatId === "string" ? input.preferredChatId : "";
  const storedChatId =
    typeof input.storedChatId === "string" ? input.storedChatId : "";

  const storedChat = storedChatId
    ? input.chats.find((chat) => chat.id === storedChatId) ?? null
    : null;
  const storedChatIsUnarchived = storedChat != null && !storedChat.archivedAt;
  const firstUnarchivedChatId =
    input.chats.find((chat) => !chat.archivedAt)?.id ?? "";

  return preferredChatId
    ? input.chats.find((chat) => chat.id === preferredChatId)?.id ?? ""
    : storedChatIsUnarchived
      ? storedChatId
      : firstUnarchivedChatId || storedChatId || input.chats[0]?.id || "";
}

export function insertCreatedChatIntoSidebar(
  chats: AccessibleChat[],
  createdChat: AccessibleChat
): AccessibleChat[] {
  return sortChatsForSidebar([
    createdChat,
    ...chats.filter((chat) => chat.id !== createdChat.id),
  ]);
}

function createChatRequestBody(input: {
  profileId: string;
  modelId: string;
}): Record<string, string> {
  return input.modelId
    ? { profileId: input.profileId, modelId: input.modelId }
    : { profileId: input.profileId };
}

export function useHomeClientChatBootstrap({
  activeProfileId,
  loadedChatIdRef,
  preferredNewChatModelId,
  preloadedChatStateRef,
  setActiveChatId,
  setChats,
  setFolders,
  setIsTemporaryChat,
  setMessages,
  setVariantsByUserMessageId,
  status,
  stop,
  syncRef,
}: UseHomeClientChatBootstrapInput) {
  const refreshChatsNonceRef = useRef(0);
  const refreshFoldersNonceRef = useRef(0);

  const refreshChats = useCallback(
    async (input: RefreshChatsInput) => {
      const refreshNonce = (refreshChatsNonceRef.current += 1);
      const response = await fetch(`/api/chats?profileId=${input.profileId}`);
      const data = (await response.json()) as ChatListResponse;

      let nextChats = data.chats ?? [];
      const hasUnarchived = nextChats.some((chat) => !chat.archivedAt);
      if (input.ensureAtLeastOne && !hasUnarchived) {
        const modelId = preferredNewChatModelId(input.profileId);
        const createResponse = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            createChatRequestBody({
              profileId: input.profileId,
              modelId,
            })
          ),
        });
        const created = (await createResponse.json()) as ChatMutationResponse;
        if (createResponse.ok && created.chat) {
          let seededChat = created.chat;
          const seedFolderId = String(input.seedFolderId ?? "").trim();

          if (seedFolderId) {
            const moveResponse = await fetch(`/api/chats/${created.chat.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                profileId: input.profileId,
                folderId: seedFolderId,
              }),
            });
            const moved = (await moveResponse.json().catch(() => null)) as
              | ChatMutationResponse
              | null;
            if (moveResponse.ok && moved?.chat) {
              seededChat = moved.chat;
            }
          }

          nextChats = [seededChat, ...nextChats];
        }
      }

      if (refreshNonce !== refreshChatsNonceRef.current) return;
      setChats(nextChats);

      const storedChatId =
        window.localStorage.getItem(`remcochat:chatId:${input.profileId}`) ??
        "";
      setActiveChatId(
        resolveRefreshedActiveChatId({
          chats: nextChats,
          preferredChatId: input.preferChatId,
          storedChatId,
        })
      );
    },
    [preferredNewChatModelId, setActiveChatId, setChats]
  );

  const refreshFolders = useCallback(
    async (profileId: string) => {
      const refreshNonce = (refreshFoldersNonceRef.current += 1);
      const response = await fetch(`/api/folders?profileId=${profileId}`);
      const data = (await response.json().catch(() => null)) as FolderListResponse;
      const nextFolders = Array.isArray(data?.folders) ? data.folders : [];
      if (refreshNonce !== refreshFoldersNonceRef.current) return;
      setFolders(nextFolders);
    },
    [setFolders]
  );

  const createChat = useCallback(async () => {
    if (!activeProfileId) return;
    const modelId = preferredNewChatModelId(activeProfileId);

    if (status !== "ready") stop();
    setIsTemporaryChat(false);

    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createChatRequestBody({
          profileId: activeProfileId,
          modelId,
        })
      ),
    });

    const data = (await response.json()) as ChatMutationResponse;
    if (!response.ok || !data.chat) return;

    const emptyMessages: UIMessage<RemcoChatMessageMetadata>[] = [];
    const emptyVariants: Record<
      string,
      UIMessage<RemcoChatMessageMetadata>[]
    > = {};

    preloadedChatStateRef.current = {
      profileId: activeProfileId,
      chatId: data.chat.id,
      messages: emptyMessages,
      variantsByUserMessageId: emptyVariants,
    };
    setMessages(emptyMessages);
    setVariantsByUserMessageId(emptyVariants);
    syncRef.current = {
      profileId: activeProfileId,
      chatId: data.chat.id,
      signature: signatureForChatState(emptyMessages, emptyVariants),
    };
    loadedChatIdRef.current = data.chat.id;

    setChats((previous) => insertCreatedChatIntoSidebar(previous, data.chat!));
    setActiveChatId(data.chat.id);
  }, [
    activeProfileId,
    loadedChatIdRef,
    preferredNewChatModelId,
    preloadedChatStateRef,
    setActiveChatId,
    setChats,
    setIsTemporaryChat,
    setMessages,
    setVariantsByUserMessageId,
    status,
    stop,
    syncRef,
  ]);

  return {
    createChat,
    refreshChats,
    refreshFolders,
  };
}
