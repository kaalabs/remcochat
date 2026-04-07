"use client";

import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import { sortChatsForSidebar } from "@/app/home-client-chat-actions";
import type {
  AccessibleChat,
  RemcoChatMessageMetadata,
} from "@/domain/chats/types";
import type { UIMessage } from "ai";

type ChatMutationResponse = {
  chat?: AccessibleChat;
  error?: string;
};

type UseHomeClientEditForkInput = {
  activeChatId: string;
  activeProfileId: string;
  isTemporaryChat: boolean;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  setActiveChatId: Dispatch<SetStateAction<string>>;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  statusReady: boolean;
  t: I18nContextValue["t"];
  variantsByUserMessageId: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  >;
};

export function canStartEditUserMessage(input: {
  isTemporaryChat: boolean;
  role: UIMessage<RemcoChatMessageMetadata>["role"];
  statusReady: boolean;
}): boolean {
  return input.role === "user" && input.statusReady && !input.isTemporaryChat;
}

export function resolveEditForkDraftText(
  message: UIMessage<RemcoChatMessageMetadata>
): string {
  if (message.role !== "user") return "";
  const textPart = message.parts.find((part) => part.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  return textPart?.text ?? "";
}

export function insertForkedChat(
  chats: AccessibleChat[],
  chat: AccessibleChat
): AccessibleChat[] {
  return sortChatsForSidebar([
    chat,
    ...chats.filter((existingChat) => existingChat.id !== chat.id),
  ]);
}

export function canSubmitEditForkRequest(input: {
  activeChatId: string;
  activeProfileId: string;
  editing: boolean;
  editingMessageId: string;
  isTemporaryChat: boolean;
  text: string;
}): boolean {
  if (!input.activeProfileId) return false;
  if (!input.activeChatId) return false;
  if (input.isTemporaryChat) return false;
  if (input.editing) return false;
  if (!input.editingMessageId) return false;
  return Boolean(input.text.trim());
}

export function useHomeClientEditFork({
  activeChatId,
  activeProfileId,
  isTemporaryChat,
  messages,
  setActiveChatId,
  setChats,
  statusReady,
  t,
  variantsByUserMessageId,
}: UseHomeClientEditForkInput) {
  const [editOpen, setEditOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string>("");
  const [editText, setEditText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const startEditUserMessage = useCallback(
    (message: UIMessage<RemcoChatMessageMetadata>) => {
      if (
        !canStartEditUserMessage({
          isTemporaryChat,
          role: message.role,
          statusReady,
        })
      ) {
        return;
      }
      setEditingMessageId(message.id);
      setEditText(resolveEditForkDraftText(message));
      setEditError(null);
      setEditOpen(true);
    },
    [isTemporaryChat, statusReady]
  );

  const forkFromEdit = useCallback(async () => {
    if (
      !canSubmitEditForkRequest({
        activeChatId,
        activeProfileId,
        editing,
        editingMessageId,
        isTemporaryChat,
        text: editText,
      })
    ) {
      return;
    }

    setEditing(true);
    setEditError(null);
    try {
      // Ensure the source chat state (including variants) is persisted before forking,
      // otherwise the server-side fork may miss locally-created variants.
      const persistRes = await fetch(`/api/chats/${activeChatId}/messages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfileId,
          messages,
          variantsByUserMessageId,
        }),
      });
      if (!persistRes.ok) {
        const data = (await persistRes.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || t("error.chat.persist_state_failed"));
      }

      const res = await fetch(`/api/chats/${activeChatId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfileId,
          userMessageId: editingMessageId,
          text: editText,
        }),
      });

      const data = (await res.json()) as ChatMutationResponse;
      if (!res.ok || !data.chat) {
        throw new Error(data.error || t("error.chat.fork_failed"));
      }

      setChats((previous) => insertForkedChat(previous, data.chat!));
      setActiveChatId(data.chat.id);
      setEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t("error.chat.fork_failed"));
    } finally {
      setEditing(false);
    }
  }, [
    activeChatId,
    activeProfileId,
    editText,
    editing,
    editingMessageId,
    isTemporaryChat,
    messages,
    setActiveChatId,
    setChats,
    t,
    variantsByUserMessageId,
  ]);

  return {
    editFork: {
      error: editError,
      open: editOpen,
      saving: editing,
      setOpen: setEditOpen,
      setText: setEditText,
      text: editText,
    },
    forkFromEdit,
    startEditUserMessage,
  };
}
