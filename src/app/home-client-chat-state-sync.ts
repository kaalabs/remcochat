"use client";

import type { UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { RemcoChatMessageMetadata } from "@/domain/chats/types";

export type HomeClientChatSyncState = {
  profileId: string;
  chatId: string;
  signature: string;
} | null;

export type HomeClientPreloadedChatState = {
  profileId: string;
  chatId: string;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  variantsByUserMessageId: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  >;
} | null;

type PersistedChatMessagesResponse = {
  messages?: UIMessage<RemcoChatMessageMetadata>[];
  variantsByUserMessageId?: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  >;
} | null;

type RefreshChatsInput = {
  profileId: string;
  preferChatId?: string;
};

type UseHomeClientChatStateSyncInput = {
  activeChatId: string;
  activeProfileId: string;
  error: unknown;
  isTemporaryChat: boolean;
  loadedChatIdRef: MutableRefObject<string>;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  preloadedChatStateRef: MutableRefObject<HomeClientPreloadedChatState>;
  queueScrollTranscriptToBottom: (behavior: "instant" | "smooth") => void;
  refreshChats: (input: RefreshChatsInput) => Promise<void>;
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
  variantsByUserMessageId: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  >;
};

function textLengthForMessage(message: UIMessage<RemcoChatMessageMetadata>) {
  return message.parts.reduce((acc, part) => {
    if (part.type === "text") return acc + part.text.length;
    return acc;
  }, 0);
}

export function signatureForChatState(
  messages: UIMessage<RemcoChatMessageMetadata>[],
  variantsByUserMessageId: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  >
) {
  const messageSig = messages
    .map((message) => `${message.id}:${message.role}:${textLengthForMessage(message)}`)
    .join("|");

  const variantSig = Object.keys(variantsByUserMessageId)
    .sort()
    .map((userMessageId) => {
      const ids = (variantsByUserMessageId[userMessageId] ?? [])
        .map((message) => `${message.id}:${textLengthForMessage(message)}`)
        .sort()
        .join(",");
      return `${userMessageId}=[${ids}]`;
    })
    .join(";");

  return `m:${messageSig};v:${variantSig}`;
}

export function normalizeLoadedChatStateResponse(
  data: PersistedChatMessagesResponse
) {
  return {
    messages: Array.isArray(data?.messages) ? data.messages : [],
    variantsByUserMessageId:
      data?.variantsByUserMessageId &&
      typeof data.variantsByUserMessageId === "object"
        ? data.variantsByUserMessageId
        : {},
  };
}

export function shouldSyncPersistedChatState(input: {
  activeChatId: string;
  activeProfileId: string;
  error: unknown;
  isTemporaryChat: boolean;
  lastSync: HomeClientChatSyncState;
  loadedChatId: string;
  signature: string;
  status: string;
}): boolean {
  if (!input.activeProfileId) return false;
  if (!input.activeChatId) return false;
  if (input.isTemporaryChat) return false;
  if (input.status !== "ready") return false;
  if (input.error) return false;
  if (input.loadedChatId !== input.activeChatId) return false;

  return !(
    input.lastSync?.profileId === input.activeProfileId &&
    input.lastSync?.chatId === input.activeChatId &&
    input.lastSync?.signature === input.signature
  );
}

export function useHomeClientChatStateSync({
  activeChatId,
  activeProfileId,
  error,
  isTemporaryChat,
  loadedChatIdRef,
  messages,
  preloadedChatStateRef,
  queueScrollTranscriptToBottom,
  refreshChats,
  setMessages,
  setVariantsByUserMessageId,
  status,
  stop,
  syncRef,
  variantsByUserMessageId,
}: UseHomeClientChatStateSyncInput) {
  useEffect(() => {
    loadedChatIdRef.current = "";
  }, [activeChatId, isTemporaryChat, loadedChatIdRef]);

  useEffect(() => {
    loadedChatIdRef.current = "";
    syncRef.current = null;
  }, [activeProfileId, loadedChatIdRef, syncRef]);

  useEffect(() => {
    if (!activeProfileId) return;
    if (!activeChatId) return;
    if (isTemporaryChat) return;

    window.localStorage.setItem(
      `remcochat:chatId:${activeProfileId}`,
      activeChatId
    );
  }, [activeChatId, activeProfileId, isTemporaryChat]);

  useEffect(() => {
    if (!activeProfileId) return;
    if (!activeChatId) return;
    if (isTemporaryChat) return;

    const preloaded = preloadedChatStateRef.current;
    if (
      preloaded &&
      preloaded.profileId === activeProfileId &&
      preloaded.chatId === activeChatId
    ) {
      setMessages(preloaded.messages);
      setVariantsByUserMessageId(preloaded.variantsByUserMessageId);
      syncRef.current = {
        profileId: activeProfileId,
        chatId: activeChatId,
        signature: signatureForChatState(
          preloaded.messages,
          preloaded.variantsByUserMessageId
        ),
      };
      loadedChatIdRef.current = activeChatId;
      preloadedChatStateRef.current = null;
      queueScrollTranscriptToBottom("instant");
      return;
    }

    let aborted = false;
    stop();

    (async () => {
      const response = await fetch(`/api/chats/${activeChatId}/messages`);
      const data = normalizeLoadedChatStateResponse(
        (await response.json()) as PersistedChatMessagesResponse
      );
      if (aborted) return;

      setMessages(data.messages);
      setVariantsByUserMessageId(data.variantsByUserMessageId);
      syncRef.current = {
        profileId: activeProfileId,
        chatId: activeChatId,
        signature: signatureForChatState(
          data.messages,
          data.variantsByUserMessageId
        ),
      };
      loadedChatIdRef.current = activeChatId;
      queueScrollTranscriptToBottom("instant");
    })().catch(() => {});

    return () => {
      aborted = true;
    };
  }, [
    activeChatId,
    activeProfileId,
    isTemporaryChat,
    loadedChatIdRef,
    preloadedChatStateRef,
    queueScrollTranscriptToBottom,
    setMessages,
    setVariantsByUserMessageId,
    stop,
    syncRef,
  ]);

  useEffect(() => {
    if (activeChatId) return;

    setMessages([]);
    syncRef.current = null;
    setVariantsByUserMessageId({});
  }, [activeChatId, setMessages, setVariantsByUserMessageId, syncRef]);

  useEffect(() => {
    const signature = signatureForChatState(messages, variantsByUserMessageId);
    if (
      !shouldSyncPersistedChatState({
        activeChatId,
        activeProfileId,
        error,
        isTemporaryChat,
        lastSync: syncRef.current,
        loadedChatId: loadedChatIdRef.current,
        signature,
        status,
      })
    ) {
      return;
    }

    syncRef.current = {
      profileId: activeProfileId,
      chatId: activeChatId,
      signature,
    };

    fetch(`/api/chats/${activeChatId}/messages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: activeProfileId,
        messages,
        variantsByUserMessageId,
      }),
    })
      .then((response) =>
        response.ok
          ? refreshChats({
              profileId: activeProfileId,
              preferChatId: activeChatId,
            })
          : null
      )
      .catch(() => {});
  }, [
    activeChatId,
    activeProfileId,
    error,
    isTemporaryChat,
    loadedChatIdRef,
    messages,
    refreshChats,
    status,
    syncRef,
    variantsByUserMessageId,
  ]);

  const resetCurrentChatState = useCallback(() => {
    stop();
    setVariantsByUserMessageId({});
    setMessages([]);
    syncRef.current = null;
    loadedChatIdRef.current = "";
  }, [loadedChatIdRef, setMessages, setVariantsByUserMessageId, stop, syncRef]);

  return {
    resetCurrentChatState,
  };
}
