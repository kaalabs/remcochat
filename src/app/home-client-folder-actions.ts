"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";
import type {
  AccessibleChatFolder,
  ChatFolder,
} from "@/domain/folders/types";
import type { FolderMember } from "@/app/home-client-folder-dialogs";
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

type FolderMutationResponse =
  | { folder?: AccessibleChatFolder | ChatFolder; error?: string }
  | null;

type FolderDeleteResponse =
  | { ok?: boolean; error?: string }
  | null;

type FolderShareResponse =
  | { ok?: boolean; error?: string }
  | null;

type FolderMembersResponse =
  | { members?: FolderMember[]; error?: string }
  | null;

type ChatMoveResponse =
  | { chat?: AccessibleChat; error?: string }
  | null;

export function normalizeFolderNameDraft(value: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function validateFolderNameDraft(
  value: string,
  t: I18nContextValue["t"],
): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeFolderNameDraft(value);
  if (!name) return { ok: false, error: t("validation.folder.name_required") };
  if (name.length > 60) {
    return { ok: false, error: t("validation.folder.name_too_long") };
  }
  return { ok: true, name };
}

export function useHomeClientFolderActions(input: {
  activeProfileId: string;
  folders: AccessibleChatFolder[];
  refreshFolders: (profileId: string) => Promise<void>;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  setFolders: Dispatch<SetStateAction<AccessibleChatFolder[]>>;
  statusReady: boolean;
  t: I18nContextValue["t"];
}) {
  const {
    activeProfileId,
    folders,
    refreshFolders,
    setChats,
    setFolders,
    statusReady,
    t,
  } = input;

  const [folderError, setFolderError] = useState<string | null>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState("");
  const [newFolderSaving, setNewFolderSaving] = useState(false);
  const [newFolderError, setNewFolderError] = useState<string | null>(null);

  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [renameFolderId, setRenameFolderId] = useState<string>("");
  const [renameFolderDraft, setRenameFolderDraft] = useState("");
  const [renameFolderSaving, setRenameFolderSaving] = useState(false);
  const [renameFolderError, setRenameFolderError] = useState<string | null>(
    null,
  );

  const [deleteFolderOpen, setDeleteFolderOpen] = useState(false);
  const [deleteFolderId, setDeleteFolderId] = useState<string>("");
  const [deleteFolderName, setDeleteFolderName] = useState<string>("");
  const [deleteFolderSaving, setDeleteFolderSaving] = useState(false);
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(
    null,
  );

  const [shareFolderOpen, setShareFolderOpen] = useState(false);
  const [shareFolderId, setShareFolderId] = useState<string>("");
  const [shareFolderName, setShareFolderName] = useState<string>("");
  const [shareFolderTarget, setShareFolderTarget] = useState<string>("");
  const [shareFolderSaving, setShareFolderSaving] = useState(false);
  const [shareFolderError, setShareFolderError] = useState<string | null>(null);

  const [manageSharingOpen, setManageSharingOpen] = useState(false);
  const [manageSharingFolderId, setManageSharingFolderId] = useState<string>("");
  const [manageSharingFolderName, setManageSharingFolderName] = useState("");
  const [manageSharingMembers, setManageSharingMembers] = useState<
    FolderMember[]
  >([]);
  const [manageSharingLoading, setManageSharingLoading] = useState(false);
  const [manageSharingSaving, setManageSharingSaving] = useState(false);
  const [manageSharingError, setManageSharingError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (newFolderOpen) return;
    setNewFolderDraft("");
    setNewFolderError(null);
    setNewFolderSaving(false);
  }, [newFolderOpen]);

  useEffect(() => {
    if (renameFolderOpen) return;
    setRenameFolderId("");
    setRenameFolderDraft("");
    setRenameFolderError(null);
    setRenameFolderSaving(false);
  }, [renameFolderOpen]);

  useEffect(() => {
    if (deleteFolderOpen) return;
    setDeleteFolderId("");
    setDeleteFolderName("");
    setDeleteFolderError(null);
    setDeleteFolderSaving(false);
  }, [deleteFolderOpen]);

  useEffect(() => {
    if (shareFolderOpen) return;
    setShareFolderId("");
    setShareFolderName("");
    setShareFolderTarget("");
    setShareFolderError(null);
    setShareFolderSaving(false);
  }, [shareFolderOpen]);

  useEffect(() => {
    if (manageSharingOpen) return;
    setManageSharingFolderId("");
    setManageSharingFolderName("");
    setManageSharingMembers([]);
    setManageSharingError(null);
    setManageSharingLoading(false);
    setManageSharingSaving(false);
  }, [manageSharingOpen]);

  const createFolderByName = useCallback(async () => {
    if (!activeProfileId) return;
    if (!statusReady) return;
    if (newFolderSaving) return;

    const next = validateFolderNameDraft(newFolderDraft, t);
    if (!next.ok) {
      setNewFolderError(next.error);
      return;
    }

    setNewFolderSaving(true);
    setNewFolderError(null);
    setFolderError(null);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId, name: next.name }),
      });

      const data = (await res.json().catch(() => null)) as FolderMutationResponse;
      if (!res.ok || !data?.folder) {
        throw new Error(data?.error || t("error.folder.create_failed"));
      }

      refreshFolders(activeProfileId).catch(() => {});
      setNewFolderOpen(false);
    } catch (err) {
      setNewFolderError(
        err instanceof Error ? err.message : t("error.folder.create_failed"),
      );
    } finally {
      setNewFolderSaving(false);
    }
  }, [
    activeProfileId,
    newFolderDraft,
    newFolderSaving,
    refreshFolders,
    statusReady,
    t,
  ]);

  const openRenameFolder = useCallback(
    (folderId: string) => {
      if (!activeProfileId) return;
      if (!statusReady) return;
      const target = folders.find((folder) => folder.id === folderId);
      if (!target) return;
      setRenameFolderId(folderId);
      setRenameFolderDraft(target.name);
      setRenameFolderError(null);
      setRenameFolderOpen(true);
    },
    [activeProfileId, folders, statusReady],
  );

  const saveRenameFolder = useCallback(async () => {
    if (!activeProfileId) return;
    if (!statusReady) return;
    if (renameFolderSaving) return;
    if (!renameFolderId) return;

    const next = validateFolderNameDraft(renameFolderDraft, t);
    if (!next.ok) {
      setRenameFolderError(next.error);
      return;
    }

    setRenameFolderSaving(true);
    setRenameFolderError(null);
    setFolderError(null);
    try {
      const res = await fetch(`/api/folders/${renameFolderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId, name: next.name }),
      });

      const data = (await res.json().catch(() => null)) as FolderMutationResponse;
      if (!res.ok || !data?.folder) {
        throw new Error(data?.error || t("error.folder.rename_failed"));
      }

      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === renameFolderId ? { ...folder, name: next.name } : folder,
        ),
      );
      refreshFolders(activeProfileId).catch(() => {});
      setRenameFolderOpen(false);
    } catch (err) {
      setRenameFolderError(
        err instanceof Error ? err.message : t("error.folder.rename_failed"),
      );
    } finally {
      setRenameFolderSaving(false);
    }
  }, [
    activeProfileId,
    refreshFolders,
    renameFolderDraft,
    renameFolderId,
    renameFolderSaving,
    setFolders,
    statusReady,
    t,
  ]);

  const openDeleteFolder = useCallback(
    (folderId: string) => {
      if (!activeProfileId) return;
      if (!statusReady) return;
      const target = folders.find((folder) => folder.id === folderId);
      if (!target) return;
      setDeleteFolderId(folderId);
      setDeleteFolderName(target.name);
      setDeleteFolderError(null);
      setDeleteFolderOpen(true);
    },
    [activeProfileId, folders, statusReady],
  );

  const openShareFolder = useCallback(
    (folderId: string) => {
      if (!activeProfileId) return;
      if (!statusReady) return;
      const target = folders.find((folder) => folder.id === folderId);
      if (!target) return;
      if (target.scope === "shared") return;
      if (target.profileId !== activeProfileId) return;
      setShareFolderId(folderId);
      setShareFolderName(target.name);
      setShareFolderTarget("");
      setShareFolderError(null);
      setShareFolderOpen(true);
    },
    [activeProfileId, folders, statusReady],
  );

  const confirmShareFolder = useCallback(async () => {
    if (!activeProfileId) return;
    if (!statusReady) return;
    if (!shareFolderId) return;
    if (shareFolderSaving) return;

    const target = String(shareFolderTarget ?? "").trim();
    if (!target) {
      setShareFolderError(t("validation.folder.share_target_required"));
      return;
    }

    setShareFolderSaving(true);
    setShareFolderError(null);
    setFolderError(null);
    try {
      const res = await fetch(`/api/folders/${shareFolderId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId, targetProfile: target }),
      });
      const data = (await res.json().catch(() => null)) as FolderShareResponse;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || t("error.folder.share_failed"));
      }
      refreshFolders(activeProfileId).catch(() => {});
      setShareFolderOpen(false);
    } catch (err) {
      setShareFolderError(
        err instanceof Error ? err.message : t("error.folder.share_failed"),
      );
    } finally {
      setShareFolderSaving(false);
    }
  }, [
    activeProfileId,
    refreshFolders,
    shareFolderId,
    shareFolderSaving,
    shareFolderTarget,
    statusReady,
    t,
  ]);

  const loadFolderMembers = useCallback(
    async (folderId: string) => {
      if (!activeProfileId) return;
      setManageSharingLoading(true);
      setManageSharingError(null);
      try {
        const res = await fetch(
          `/api/folders/${folderId}/members?profileId=${activeProfileId}`,
        );
        const data = (await res.json().catch(() => null)) as FolderMembersResponse;
        if (!res.ok) {
          throw new Error(
            data?.error || t("error.folder.sharing_settings_load_failed"),
          );
        }
        setManageSharingMembers(Array.isArray(data?.members) ? data.members : []);
      } catch (err) {
        setManageSharingError(
          err instanceof Error
            ? err.message
            : t("error.folder.sharing_settings_load_failed"),
        );
      } finally {
        setManageSharingLoading(false);
      }
    },
    [activeProfileId, t],
  );

  const openManageFolderSharing = useCallback(
    (folderId: string) => {
      if (!activeProfileId) return;
      if (!statusReady) return;
      const target = folders.find((folder) => folder.id === folderId);
      if (!target) return;
      if (target.scope === "shared") return;
      if (target.profileId !== activeProfileId) return;
      setManageSharingFolderId(folderId);
      setManageSharingFolderName(target.name);
      setManageSharingOpen(true);
      loadFolderMembers(folderId).catch(() => {});
    },
    [activeProfileId, folders, loadFolderMembers, statusReady],
  );

  const stopSharingFolderWithMember = useCallback(
    async (member: FolderMember) => {
      if (!activeProfileId) return;
      if (!statusReady) return;
      if (!manageSharingFolderId) return;
      if (manageSharingSaving) return;

      setManageSharingSaving(true);
      setManageSharingError(null);
      setFolderError(null);
      try {
        const res = await fetch(`/api/folders/${manageSharingFolderId}/unshare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: activeProfileId,
            targetProfile: member.profileId,
          }),
        });
        const data = (await res.json().catch(() => null)) as FolderShareResponse;
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || t("error.folder.stop_sharing_failed"));
        }
        setManageSharingMembers((prev) =>
          prev.filter((entry) => entry.profileId !== member.profileId),
        );
        refreshFolders(activeProfileId).catch(() => {});
      } catch (err) {
        setManageSharingError(
          err instanceof Error
            ? err.message
            : t("error.folder.stop_sharing_failed"),
        );
      } finally {
        setManageSharingSaving(false);
      }
    },
    [
      activeProfileId,
      manageSharingFolderId,
      manageSharingSaving,
      refreshFolders,
      statusReady,
      t,
    ],
  );

  const confirmDeleteFolder = useCallback(async () => {
    if (!activeProfileId) return;
    if (!statusReady) return;
    if (deleteFolderSaving) return;
    if (!deleteFolderId) return;

    setDeleteFolderSaving(true);
    setDeleteFolderError(null);
    setFolderError(null);
    try {
      const res = await fetch(`/api/folders/${deleteFolderId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId }),
      });
      const data = (await res.json().catch(() => null)) as FolderDeleteResponse;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || t("error.folder.delete_failed"));
      }

      setFolders((prev) => prev.filter((folder) => folder.id !== deleteFolderId));
      setChats((prev) =>
        prev.map((chat) =>
          chat.folderId === deleteFolderId ? { ...chat, folderId: null } : chat,
        ),
      );

      setDeleteFolderOpen(false);
    } catch (err) {
      setDeleteFolderError(
        err instanceof Error ? err.message : t("error.folder.delete_failed"),
      );
    } finally {
      setDeleteFolderSaving(false);
    }
  }, [
    activeProfileId,
    deleteFolderId,
    deleteFolderSaving,
    setChats,
    setFolders,
    statusReady,
    t,
  ]);

  const toggleFolderCollapsed = useCallback(
    async (folderId: string, nextCollapsed: boolean) => {
      if (!activeProfileId) return;
      if (!statusReady) return;

      setFolderError(null);
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === folderId
            ? { ...folder, collapsed: nextCollapsed }
            : folder,
        ),
      );

      try {
        const res = await fetch(`/api/folders/${folderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: activeProfileId,
            collapsed: nextCollapsed,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; folder?: AccessibleChatFolder | ChatFolder; error?: string }
          | null;
        if (!res.ok) {
          throw new Error(data?.error || t("error.folder.update_failed"));
        }
      } catch (err) {
        setFolderError(
          err instanceof Error ? err.message : t("error.folder.update_failed"),
        );
        refreshFolders(activeProfileId).catch(() => {});
      }
    },
    [activeProfileId, refreshFolders, setFolders, statusReady, t],
  );

  const moveChatToFolder = useCallback(
    async (chatId: string, folderId: string | null) => {
      if (!activeProfileId) return;
      if (!statusReady) return;

      setFolderError(null);
      try {
        const res = await fetch(`/api/chats/${chatId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: activeProfileId, folderId }),
        });
        const data = (await res.json().catch(() => null)) as ChatMoveResponse;
        if (!res.ok || !data?.chat) {
          throw new Error(data?.error || t("error.chat.move_failed"));
        }

        setChats((prev) =>
          prev.map((chat) => (chat.id === chatId ? data.chat! : chat)),
        );
      } catch (err) {
        setFolderError(
          err instanceof Error ? err.message : t("error.chat.move_failed"),
        );
      }
    },
    [activeProfileId, setChats, statusReady, t],
  );

  return {
    confirmDeleteFolder,
    confirmShareFolder,
    createFolderByName,
    deleteFolder: {
      error: deleteFolderError,
      folderId: deleteFolderId,
      name: deleteFolderName,
      open: deleteFolderOpen,
      saving: deleteFolderSaving,
      setOpen: setDeleteFolderOpen,
    },
    folderError,
    setFolderError,
    manageSharing: {
      error: manageSharingError,
      folderName: manageSharingFolderName,
      loading: manageSharingLoading,
      members: manageSharingMembers,
      open: manageSharingOpen,
      saving: manageSharingSaving,
      setOpen: setManageSharingOpen,
    },
    moveChatToFolder,
    newFolder: {
      draft: newFolderDraft,
      error: newFolderError,
      open: newFolderOpen,
      saving: newFolderSaving,
      setDraft: setNewFolderDraft,
      setError: setNewFolderError,
      setOpen: setNewFolderOpen,
    },
    openDeleteFolder,
    openManageFolderSharing,
    openRenameFolder,
    openShareFolder,
    renameFolder: {
      draft: renameFolderDraft,
      error: renameFolderError,
      folderId: renameFolderId,
      open: renameFolderOpen,
      saving: renameFolderSaving,
      setDraft: setRenameFolderDraft,
      setError: setRenameFolderError,
      setOpen: setRenameFolderOpen,
    },
    saveRenameFolder,
    shareFolder: {
      error: shareFolderError,
      folderId: shareFolderId,
      name: shareFolderName,
      open: shareFolderOpen,
      saving: shareFolderSaving,
      setError: setShareFolderError,
      setOpen: setShareFolderOpen,
      setTarget: setShareFolderTarget,
      target: shareFolderTarget,
    },
    stopSharingFolderWithMember,
    toggleFolderCollapsed,
  };
}
