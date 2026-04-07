"use client";

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";

type RefreshChatsInput = {
  profileId: string;
  preferChatId?: string;
};

type ChatMutationResponse = {
  chat?: AccessibleChat;
  error?: string;
};

type UseHomeClientChatSettingsInput = {
  activeChat: AccessibleChat | null;
  activeProfileId: string;
  canManageActiveChat: boolean;
  chats: AccessibleChat[];
  isTemporaryChat: boolean;
  refreshChats: (input: RefreshChatsInput) => Promise<void>;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  statusReady: boolean;
  t: I18nContextValue["t"];
};

export function canOpenChatSettings(input: {
  activeChatId: string;
  canManageActiveChat: boolean;
  isTemporaryChat: boolean;
  statusReady: boolean;
}): boolean {
  if (!input.statusReady) return false;
  if (input.isTemporaryChat) return false;
  if (!input.canManageActiveChat) return false;
  return Boolean(input.activeChatId);
}

export function resolveChatSettingsTargetId(input: {
  activeChatId: string;
  chatSettingsChatId: string;
}): string {
  return input.chatSettingsChatId || input.activeChatId || "";
}

export function resolveChatInstructionsDraft(input: {
  activeChat: AccessibleChat | null;
  chatSettingsChatId: string;
  chats: AccessibleChat[];
}): string {
  const target =
    input.chats.find((chat) => chat.id === input.chatSettingsChatId) ??
    input.activeChat;
  return target?.chatInstructions ?? "";
}

export function useHomeClientChatSettings({
  activeChat,
  activeProfileId,
  canManageActiveChat,
  chats,
  isTemporaryChat,
  refreshChats,
  setChats,
  statusReady,
  t,
}: UseHomeClientChatSettingsInput) {
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [chatSettingsChatId, setChatSettingsChatId] = useState<string>("");
  const [chatInstructionsDraft, setChatInstructionsDraft] = useState("");
  const [chatSettingsSaving, setChatSettingsSaving] = useState(false);
  const [chatSettingsError, setChatSettingsError] = useState<string | null>(null);

  const openChatSettings = useCallback(() => {
    const chatId = activeChat?.id ?? "";
    if (
      !canOpenChatSettings({
        activeChatId: chatId,
        canManageActiveChat,
        isTemporaryChat,
        statusReady,
      })
    ) {
      return;
    }

    setChatSettingsChatId(chatId);
    setChatSettingsOpen(true);
  }, [activeChat?.id, canManageActiveChat, isTemporaryChat, statusReady]);

  useEffect(() => {
    if (!chatSettingsOpen) return;
    setChatSettingsError(null);
    setChatInstructionsDraft(
      resolveChatInstructionsDraft({
        activeChat,
        chatSettingsChatId,
        chats,
      })
    );
  }, [activeChat, chatSettingsChatId, chatSettingsOpen, chats]);

  const saveChatSettings = useCallback(async () => {
    if (!activeProfileId) return;
    const targetChatId = resolveChatSettingsTargetId({
      activeChatId: activeChat?.id ?? "",
      chatSettingsChatId,
    });
    if (!targetChatId) return;
    if (chatSettingsSaving) return;

    setChatSettingsSaving(true);
    setChatSettingsError(null);
    try {
      const response = await fetch(`/api/chats/${targetChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfileId,
          chatInstructions: chatInstructionsDraft,
        }),
      });

      const data = (await response.json()) as ChatMutationResponse;
      if (!response.ok || !data.chat) {
        throw new Error(data.error || t("error.chat.settings_save_failed"));
      }

      setChats((previous) =>
        previous.map((chat) => (chat.id === data.chat!.id ? data.chat! : chat))
      );
      refreshChats({
        profileId: activeProfileId,
        preferChatId: data.chat.id,
      }).catch(() => {});
      setChatSettingsChatId("");
      setChatSettingsOpen(false);
    } catch (err) {
      setChatSettingsError(
        err instanceof Error ? err.message : t("error.chat.settings_save_failed")
      );
    } finally {
      setChatSettingsSaving(false);
    }
  }, [
    activeChat?.id,
    activeProfileId,
    chatInstructionsDraft,
    chatSettingsChatId,
    chatSettingsSaving,
    refreshChats,
    setChats,
    t,
  ]);

  return {
    chatSettings: {
      error: chatSettingsError,
      instructionsDraft: chatInstructionsDraft,
      open: chatSettingsOpen,
      saving: chatSettingsSaving,
      setInstructionsDraft: setChatInstructionsDraft,
      setOpen: setChatSettingsOpen,
    },
    openChatSettings,
    saveChatSettings,
  };
}
