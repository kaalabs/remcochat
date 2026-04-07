"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";
import { validateChatTitle } from "@/lib/chat-title";

type SidebarChatLike = Pick<AccessibleChat, "pinnedAt" | "updatedAt">;

type RefreshChatsInput = {
  profileId: string;
  preferChatId?: string;
  ensureAtLeastOne?: boolean;
  seedFolderId?: string | null;
};

type ChatMutationResponse = {
  chat?: AccessibleChat;
  error?: string;
};

type ChatDeleteResponse = {
  ok?: boolean;
  error?: string;
};

type UseHomeClientChatActionsInput = {
  activeProfileId: string;
  chats: AccessibleChat[];
  refreshChats: (input: RefreshChatsInput) => Promise<void>;
  setArchivedOpen: Dispatch<SetStateAction<boolean>>;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  statusReady: boolean;
  t: I18nContextValue["t"];
};

export function chatIsPinned(
  chat: Pick<AccessibleChat, "pinnedAt">
): boolean {
  return typeof chat.pinnedAt === "string" && chat.pinnedAt.trim().length > 0;
}

export function compareChatsForSidebar<T extends SidebarChatLike>(
  a: T,
  b: T
): number {
  const aPinned = chatIsPinned(a);
  const bPinned = chatIsPinned(b);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;

  if (aPinned && bPinned) {
    const aPinnedAt = a.pinnedAt ?? "";
    const bPinnedAt = b.pinnedAt ?? "";
    if (aPinnedAt !== bPinnedAt) return bPinnedAt.localeCompare(aPinnedAt);
  }

  return b.updatedAt.localeCompare(a.updatedAt);
}

export function sortChatsForSidebar<T extends SidebarChatLike>(
  chats: T[]
): T[] {
  return [...chats].sort(compareChatsForSidebar);
}

export function useHomeClientChatActions({
  activeProfileId,
  chats,
  refreshChats,
  setArchivedOpen,
  setChats,
  statusReady,
  t,
}: UseHomeClientChatActionsInput) {
  const [renameChatOpen, setRenameChatOpen] = useState(false);
  const [renameChatId, setRenameChatId] = useState<string>("");
  const [renameChatDraft, setRenameChatDraft] = useState("");
  const [renameChatSaving, setRenameChatSaving] = useState(false);
  const [renameChatError, setRenameChatError] = useState<string | null>(null);

  const [deleteChatSaving, setDeleteChatSaving] = useState(false);
  const [deleteChatError, setDeleteChatError] = useState<string | null>(null);

  useEffect(() => {
    if (renameChatOpen) return;
    setRenameChatId("");
    setRenameChatDraft("");
    setRenameChatError(null);
    setRenameChatSaving(false);
  }, [renameChatOpen]);

  const renameChatValidation = useMemo(() => {
    return validateChatTitle(renameChatDraft);
  }, [renameChatDraft]);

  const canSaveRenameChat =
    Boolean(activeProfileId) &&
    statusReady &&
    Boolean(renameChatId) &&
    !renameChatSaving &&
    renameChatValidation.ok;

  const archiveChatById = useCallback(
    async (chatId: string) => {
      if (!activeProfileId) return;
      if (!statusReady) return;
      await fetch(`/api/chats/${chatId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId }),
      }).catch(() => {});
      setArchivedOpen(true);
      refreshChats({
        profileId: activeProfileId,
        ensureAtLeastOne: true,
      }).catch(() => {});
    },
    [activeProfileId, refreshChats, setArchivedOpen, statusReady]
  );

  const unarchiveChatById = useCallback(
    async (chatId: string) => {
      if (!activeProfileId) return;
      if (!statusReady) return;
      await fetch(`/api/chats/${chatId}/archive`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId }),
      }).catch(() => {});
      refreshChats({ profileId: activeProfileId, preferChatId: chatId }).catch(
        () => {}
      );
    },
    [activeProfileId, refreshChats, statusReady]
  );

  const togglePinChatById = useCallback(
    async (chatId: string, nextPinned: boolean) => {
      if (!activeProfileId) return;
      if (!statusReady) return;

      const res = await fetch(`/api/chats/${chatId}/pin`, {
        method: nextPinned ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId }),
      }).catch(() => null);
      if (!res) return;

      const data = (await res.json().catch(() => null)) as ChatMutationResponse | null;
      if (!res.ok || !data?.chat) return;

      const updated = data.chat;
      setChats((prev) =>
        sortChatsForSidebar(
          prev.map((chat) => (chat.id === updated.id ? updated : chat))
        )
      );
    },
    [activeProfileId, setChats, statusReady]
  );

  const deleteChatById = useCallback(
    async (chatId: string, folderIdHint?: string | null) => {
      if (!activeProfileId) return;
      if (deleteChatSaving) return;
      if (!statusReady) return;

      const deletedFolderId =
        folderIdHint ?? chats.find((chat) => chat.id === chatId)?.folderId ?? null;

      setDeleteChatSaving(true);
      setDeleteChatError(null);
      try {
        const res = await fetch(`/api/chats/${chatId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: activeProfileId }),
        });
        const data = (await res.json().catch(() => null)) as ChatDeleteResponse | null;
        if (!res.ok) {
          throw new Error(data?.error || t("error.chat.delete_failed"));
        }

        refreshChats({
          profileId: activeProfileId,
          ensureAtLeastOne: true,
          seedFolderId: deletedFolderId,
        }).catch(() => {});
      } catch (err) {
        setDeleteChatError(
          err instanceof Error ? err.message : t("error.chat.delete_failed")
        );
      } finally {
        setDeleteChatSaving(false);
      }
    },
    [activeProfileId, chats, deleteChatSaving, refreshChats, statusReady, t]
  );

  const openRenameChat = useCallback(
    (chatId: string) => {
      if (!activeProfileId) return;
      if (!statusReady) return;
      const target = chats.find((chat) => chat.id === chatId);
      if (!target) return;
      setRenameChatId(chatId);
      setRenameChatDraft(target.title);
      setRenameChatError(null);
      setRenameChatOpen(true);
    },
    [activeProfileId, chats, statusReady]
  );

  const renameChatTitle = useCallback(async () => {
    if (!activeProfileId) return;
    if (!statusReady) return;
    if (renameChatSaving) return;
    if (!renameChatId) return;

    const nextTitle = validateChatTitle(renameChatDraft);
    if (!nextTitle.ok) {
      setRenameChatError(nextTitle.error);
      return;
    }

    setRenameChatSaving(true);
    setRenameChatError(null);
    try {
      const res = await fetch(`/api/chats/${renameChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId, title: nextTitle.title }),
      });

      const data = (await res.json().catch(() => null)) as ChatMutationResponse | null;
      if (!res.ok || !data?.chat) {
        throw new Error(data?.error || t("error.chat.rename_failed"));
      }

      const updated = data.chat;
      setChats((prev) =>
        sortChatsForSidebar(
          prev.map((chat) => (chat.id === updated.id ? updated : chat))
        )
      );

      setRenameChatOpen(false);
    } catch (err) {
      setRenameChatError(
        err instanceof Error ? err.message : t("error.chat.rename_failed")
      );
    } finally {
      setRenameChatSaving(false);
    }
  }, [
    activeProfileId,
    renameChatDraft,
    renameChatId,
    renameChatSaving,
    setChats,
    statusReady,
    t,
  ]);

  const exportChatById = useCallback(
    (chatId: string, format: "md" | "json") => {
      if (!activeProfileId) return;
      const url = `/api/chats/${chatId}/export?profileId=${encodeURIComponent(
        activeProfileId
      )}&format=${format}`;
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [activeProfileId]
  );

  return {
    archiveChatById,
    canSaveRenameChat,
    deleteChat: {
      error: deleteChatError,
      saving: deleteChatSaving,
    },
    deleteChatById,
    exportChatById,
    openRenameChat,
    renameChat: {
      draft: renameChatDraft,
      error: renameChatError,
      open: renameChatOpen,
      saving: renameChatSaving,
      setDraft: setRenameChatDraft,
      setError: setRenameChatError,
      setOpen: setRenameChatOpen,
      validation: renameChatValidation,
    },
    renameChatTitle,
    togglePinChatById,
    unarchiveChatById,
  };
}
