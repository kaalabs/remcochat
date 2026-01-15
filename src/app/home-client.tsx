"use client";

import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { ModelPicker } from "@/components/model-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_MODEL_ID,
  getModelLabel,
  isAllowedModel,
  MODEL_ALLOWLIST,
} from "@/lib/models";
import type { Chat, Profile, RemcoChatMessageMetadata } from "@/lib/types";
import { Loader } from "@/components/ai-elements/loader";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StickToBottom } from "use-stick-to-bottom";
import { MessageActions, MessageAction } from "@/components/ai-elements/message";
import { Weather } from "@/components/weather";
import { WeatherForecast } from "@/components/weather-forecast";
import { MemoryCard } from "@/components/memory-card";
import type { WeatherToolOutput } from "@/ai/weather";
import type { WeatherForecastToolOutput } from "@/ai/weather";
import {
	  ArchiveIcon,
	  BookmarkIcon,
	  ChevronDownIcon,
	  ShieldIcon,
	  DownloadIcon,
	  MoreVerticalIcon,
	  PlusIcon,
	  PencilIcon,
	  LockIcon,
	  LockOpenIcon,
	  RotateCcwIcon,
	  SettingsIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import type { MemoryItem } from "@/lib/types";
import { nanoid } from "nanoid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

function textLengthForMessage(message: UIMessage<RemcoChatMessageMetadata>) {
  return message.parts.reduce((acc, part) => {
    if (part.type === "text") return acc + part.text.length;
    return acc;
  }, 0);
}

function signatureForChatState(
  messages: UIMessage<RemcoChatMessageMetadata>[],
  variantsByUserMessageId: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  >
) {
  const messageSig = messages
    .map((m) => `${m.id}:${m.role}:${textLengthForMessage(m)}`)
    .join("|");

  const variantSig = Object.keys(variantsByUserMessageId)
    .sort()
    .map((userMessageId) => {
      const ids = (variantsByUserMessageId[userMessageId] ?? [])
        .map((m) => `${m.id}:${textLengthForMessage(m)}`)
        .sort()
        .join(",");
      return `${userMessageId}=[${ids}]`;
    })
    .join(";");

  return `m:${messageSig};v:${variantSig}`;
}

export type HomeClientProps = {
  adminEnabled: boolean;
  appVersion: string;
  initialProfiles: Profile[];
  initialChats: Chat[];
};

export function HomeClient({
  adminEnabled,
  appVersion,
  initialProfiles,
  initialChats,
}: HomeClientProps) {
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [activeProfileId, setActiveProfileId] = useState<string>(
    initialProfiles[0]?.id ?? ""
  );
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [activeChatId, setActiveChatId] = useState<string>(
    initialChats[0]?.id ?? ""
  );
  const [variantsByUserMessageId, setVariantsByUserMessageId] = useState<
    Record<string, UIMessage<RemcoChatMessageMetadata>[]>
  >({});

  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const [temporarySessionId, setTemporarySessionId] = useState(() => nanoid());
  const [temporaryModelId, setTemporaryModelId] = useState(DEFAULT_MODEL_ID);

  useEffect(() => {
    const stored = window.localStorage.getItem("remcochat:profileId");
    if (!stored) return;
    if (stored === activeProfileId) return;
    if (!profiles.some((p) => p.id === stored)) return;
    setActiveProfileId(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeProfileId) return;
    window.localStorage.setItem("remcochat:profileId", activeProfileId);
  }, [activeProfileId]);

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;
  }, [profiles, activeProfileId]);

  const profileDefaultModelId = isAllowedModel(activeProfile?.defaultModelId)
    ? activeProfile!.defaultModelId
    : DEFAULT_MODEL_ID;

  const lastUsedModelKey = useCallback((profileId: string) => {
    return `remcochat:lastModelId:${profileId}`;
  }, []);

  useEffect(() => {
    if (!isAllowedModel(temporaryModelId)) {
      setTemporaryModelId(profileDefaultModelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileDefaultModelId]);

  const activeChat = useMemo(() => {
    return chats.find((c) => c.id === activeChatId) ?? null;
  }, [chats, activeChatId]);

  useEffect(() => {
    if (isTemporaryChat) return;
    if (activeChatId && activeChat) return;
    const first = chats.find((c) => !c.archivedAt)?.id ?? "";
    if (!first) return;
    setActiveChatId(first);
  }, [activeChat, activeChatId, chats, isTemporaryChat]);

  const chatModelId = isAllowedModel(activeChat?.modelId)
    ? activeChat!.modelId
    : profileDefaultModelId;

  const effectiveModelId = isTemporaryChat ? temporaryModelId : chatModelId;

  useEffect(() => {
    if (!activeProfile) return;
    if (!isAllowedModel(effectiveModelId)) return;
    window.localStorage.setItem(lastUsedModelKey(activeProfile.id), effectiveModelId);
  }, [activeProfile, effectiveModelId, lastUsedModelKey]);

  const chatSessionKey = isTemporaryChat
    ? `temp:${temporarySessionId}`
    : activeChat?.id || "no-chat";

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    regenerate,
  } = useChat<UIMessage<RemcoChatMessageMetadata>>({
    id: chatSessionKey,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const showThinking =
    error == null &&
    (status === "submitted" ||
      (status === "streaming" &&
        (() => {
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role === "assistant") {
              return !m.parts.some((p) => p.type === "text" && p.text.trim());
            }
            if (m.role === "user") {
              return true;
            }
          }
          return true;
        })()));

  const [input, setInput] = useState("");
  const canSend = status === "ready" && input.trim().length > 0;

  const [createOpen, setCreateOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string>("");
  const [editText, setEditText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [profileInstructionsDraft, setProfileInstructionsDraft] = useState("");
  const [memoryEnabledDraft, setMemoryEnabledDraft] = useState(true);
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);

  const [deleteProfileOpen, setDeleteProfileOpen] = useState(false);
  const [deleteProfileConfirm, setDeleteProfileConfirm] = useState("");
  const [deleteProfileSaving, setDeleteProfileSaving] = useState(false);
  const [deleteProfileError, setDeleteProfileError] = useState<string | null>(null);

  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [chatSettingsChatId, setChatSettingsChatId] = useState<string>("");
  const [chatInstructionsDraft, setChatInstructionsDraft] = useState("");
  const [chatSettingsSaving, setChatSettingsSaving] = useState(false);
  const [chatSettingsError, setChatSettingsError] = useState<string | null>(null);

  const [memorizeOpen, setMemorizeOpen] = useState(false);
  const [memorizeText, setMemorizeText] = useState("");
  const [memorizeSaving, setMemorizeSaving] = useState(false);
  const [memorizeError, setMemorizeError] = useState<string | null>(null);

  const [deleteChatOpen, setDeleteChatOpen] = useState(false);
  const [deleteChatId, setDeleteChatId] = useState("");
  const [deleteChatTitle, setDeleteChatTitle] = useState("");
  const [deleteChatSaving, setDeleteChatSaving] = useState(false);
  const [deleteChatError, setDeleteChatError] = useState<string | null>(null);

  const [archivedOpen, setArchivedOpen] = useState(false);
  const [profileSelectOpen, setProfileSelectOpen] = useState(false);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminResetConfirm, setAdminResetConfirm] = useState("");
  const [adminResetSaving, setAdminResetSaving] = useState(false);

  useEffect(() => {
    if (!adminOpen) return;
    setAdminError(null);
    setAdminResetConfirm("");
  }, [adminOpen]);

  useEffect(() => {
    if (!deleteProfileOpen) return;
    setDeleteProfileError(null);
    setDeleteProfileConfirm("");
  }, [deleteProfileOpen]);

  const focusComposer = useCallback((opts?: { toEnd?: boolean }) => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const el = document.querySelector(
        '[data-testid="composer:textarea"]'
      ) as HTMLTextAreaElement | null;
      if (!el) return;
      el.focus();
      if (opts?.toEnd) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  }, []);

  const syncRef = useRef<{
    profileId: string;
    chatId: string;
    signature: string;
  } | null>(null);

  const loadedChatIdRef = useRef<string>("");

  const chatRequestBody = useMemo(() => {
    if (!activeProfile) return null;
    if (isTemporaryChat) {
      return {
        profileId: activeProfile.id,
        modelId: effectiveModelId,
        temporary: true,
      };
    }
    if (!activeChat) return null;
    return {
      profileId: activeProfile.id,
      chatId: activeChat.id,
      modelId: effectiveModelId,
    };
  }, [activeChat, activeProfile, effectiveModelId, isTemporaryChat]);

  const refreshChats = useCallback(async (input: {
    profileId: string;
    preferChatId?: string;
    ensureAtLeastOne?: boolean;
  }) => {
    const res = await fetch(`/api/chats?profileId=${input.profileId}`);
    const data = (await res.json()) as { chats?: Chat[]; error?: string };

    let nextChats = data.chats ?? [];
    const hasUnarchived = nextChats.some((c) => !c.archivedAt);
    if (input.ensureAtLeastOne && !hasUnarchived) {
      const storedModelId = window.localStorage.getItem(
        lastUsedModelKey(input.profileId)
      );
      const seedModelId = isAllowedModel(storedModelId)
        ? storedModelId
        : profileDefaultModelId;

      const createRes = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: input.profileId,
          modelId: seedModelId,
        }),
      });
      const created = (await createRes.json()) as { chat?: Chat };
      if (createRes.ok && created.chat) {
        nextChats = [created.chat, ...nextChats];
      }
    }

    setChats(nextChats);

    const storedChatId =
      window.localStorage.getItem(`remcochat:chatId:${input.profileId}`) ?? "";

    const preferredChatId =
      typeof input.preferChatId === "string" ? input.preferChatId : "";

    const storedChat = storedChatId
      ? nextChats.find((c) => c.id === storedChatId) ?? null
      : null;

    const storedChatIsUnarchived = storedChat != null && !storedChat.archivedAt;
    const firstUnarchivedChatId = nextChats.find((c) => !c.archivedAt)?.id ?? "";

    const nextActiveChatId = preferredChatId
      ? nextChats.find((c) => c.id === preferredChatId)?.id ?? ""
      : storedChatIsUnarchived
        ? storedChatId
        : firstUnarchivedChatId || storedChatId || nextChats[0]?.id || "";

    setActiveChatId(nextActiveChatId);
  }, [profileDefaultModelId]);

  const createProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    if (creating) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, defaultModelId: profileDefaultModelId }),
      });

      const data = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "Failed to create profile.");
      }

      setProfiles((prev) => [...prev, data.profile!]);
      setActiveProfileId(data.profile.id);
      setChats([]);
      setActiveChatId("");
      setNewProfileName("");
      setCreateOpen(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create profile."
      );
    } finally {
      setCreating(false);
    }
  };

  const createChat = async () => {
    if (!activeProfile) return;

    const storedModelId = window.localStorage.getItem(
      lastUsedModelKey(activeProfile.id)
    );
    const seedModelId = isAllowedModel(storedModelId)
      ? storedModelId
      : effectiveModelId;

    if (status !== "ready") stop();
    setIsTemporaryChat(false);

    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: activeProfile.id,
        modelId: seedModelId || profileDefaultModelId,
      }),
    });

    const data = (await res.json()) as { chat?: Chat; error?: string };
    if (!res.ok || !data.chat) return;

    setChats((prev) => [data.chat!, ...prev]);
    setActiveChatId(data.chat.id);
  };

  const archiveChatById = useCallback(
    async (chatId: string) => {
      if (!activeProfile) return;
      if (status !== "ready") return;
      await fetch(`/api/chats/${chatId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfile.id }),
      }).catch(() => {});
      setArchivedOpen(true);
      refreshChats({
        profileId: activeProfile.id,
        ensureAtLeastOne: true,
      }).catch(() => {});
    },
    [activeProfile, refreshChats, status]
  );

  const unarchiveChatById = useCallback(
    async (chatId: string) => {
      if (!activeProfile) return;
      if (status !== "ready") return;
      await fetch(`/api/chats/${chatId}/archive`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfile.id }),
      }).catch(() => {});
      refreshChats({ profileId: activeProfile.id, preferChatId: chatId }).catch(
        () => {}
      );
    },
    [activeProfile, refreshChats, status]
  );

  useEffect(() => {
    if (!chats.some((c) => Boolean(c.archivedAt))) {
      setArchivedOpen(false);
    }
  }, [chats]);

  const refreshProfiles = useCallback(async () => {
    const res = await fetch("/api/profiles");
    const data = (await res.json().catch(() => null)) as
      | { profiles?: Profile[]; error?: string }
      | null;
    const nextProfiles = data?.profiles ?? [];
    setProfiles(nextProfiles);
    const nextId = nextProfiles[0]?.id ?? "";
    setActiveProfileId(nextId);
    setChats([]);
    setActiveChatId("");
    setIsTemporaryChat(false);
  }, []);

  const exportChatById = useCallback(
    (chatId: string, format: "md" | "json") => {
      if (!activeProfile) return;
      const url = `/api/chats/${chatId}/export?profileId=${encodeURIComponent(
        activeProfile.id
      )}&format=${format}`;
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [activeProfile]
  );

  const exportAllData = useCallback(() => {
    if (!adminEnabled) return;
    const a = document.createElement("a");
    a.href = "/api/admin/export";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [adminEnabled]);

  const resetAllData = useCallback(async () => {
    if (!adminEnabled) return;
    if (adminResetSaving) return;
    if (adminResetConfirm !== "RESET") return;

    setAdminResetSaving(true);
    setAdminError(null);
    try {
      const res = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error || "Failed to reset.");
      }
      setAdminResetConfirm("");
      setAdminOpen(false);
      await refreshProfiles();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "Failed to reset.");
    } finally {
      setAdminResetSaving(false);
    }
  }, [adminEnabled, adminResetConfirm, adminResetSaving, refreshProfiles]);

  const startDeleteChat = useCallback(
    (chat: Chat) => {
      if (status !== "ready") return;
      setDeleteChatError(null);
      setDeleteChatId(chat.id);
      setDeleteChatTitle(chat.title.trim() ? chat.title.trim() : "New chat");
      setDeleteChatOpen(true);
    },
    [status]
  );

  const confirmDeleteChat = useCallback(async () => {
    if (!activeProfile) return;
    if (!deleteChatId) return;
    if (deleteChatSaving) return;
    if (status !== "ready") return;

    setDeleteChatSaving(true);
    setDeleteChatError(null);
    try {
      const res = await fetch(`/api/chats/${deleteChatId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfile.id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete chat.");
      }

      setDeleteChatOpen(false);
      setDeleteChatId("");
      setDeleteChatTitle("");
      refreshChats({ profileId: activeProfile.id, ensureAtLeastOne: true }).catch(
        () => {}
      );
    } catch (err) {
      setDeleteChatError(
        err instanceof Error ? err.message : "Failed to delete chat."
      );
    } finally {
      setDeleteChatSaving(false);
    }
  }, [activeProfile, deleteChatId, deleteChatSaving, refreshChats, status]);

  const setChatModel = async (nextModelId: string) => {
    if (!activeProfile) return;
    if (!activeChat) return;
    if (!isAllowedModel(nextModelId)) return;
    if (nextModelId === activeChat.modelId) return;

    const res = await fetch(`/api/chats/${activeChat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: nextModelId }),
    });

    const data = (await res.json()) as { chat?: Chat };
    if (!res.ok || !data.chat) return;

    setChats((prev) => prev.map((c) => (c.id === data.chat!.id ? data.chat! : c)));
  };

  useEffect(() => {
    if (!activeProfile) return;
    refreshChats({ profileId: activeProfile.id, ensureAtLeastOne: true }).catch(
      () => {}
    );
  }, [activeProfile, refreshChats]);

  useEffect(() => {
    loadedChatIdRef.current = "";
  }, [activeChatId, isTemporaryChat]);

  useEffect(() => {
    if (!activeProfile) return;
    if (!activeChatId) return;
    if (isTemporaryChat) return;

    window.localStorage.setItem(
      `remcochat:chatId:${activeProfile.id}`,
      activeChatId
    );
  }, [activeChatId, activeProfile, isTemporaryChat]);

  useEffect(() => {
    if (!activeProfile) return;
    if (!activeChatId) return;
    if (isTemporaryChat) return;

    let aborted = false;
    stop();

    (async () => {
      const res = await fetch(`/api/chats/${activeChatId}/messages`);
      const data = (await res.json()) as {
        messages?: UIMessage<RemcoChatMessageMetadata>[];
        variantsByUserMessageId?: Record<
          string,
          UIMessage<RemcoChatMessageMetadata>[]
        >;
      };
      if (aborted) return;
      const loaded = Array.isArray(data.messages) ? data.messages : [];
      const loadedVariants =
        data.variantsByUserMessageId &&
        typeof data.variantsByUserMessageId === "object"
          ? data.variantsByUserMessageId
          : {};
      setMessages(loaded);
      setVariantsByUserMessageId(loadedVariants);
      syncRef.current = {
        profileId: activeProfile.id,
        chatId: activeChatId,
        signature: signatureForChatState(loaded, loadedVariants),
      };
      loadedChatIdRef.current = activeChatId;
    })().catch(() => {});

    return () => {
      aborted = true;
    };
  }, [activeChatId, activeProfile, isTemporaryChat, setMessages, stop]);

  useEffect(() => {
    if (activeChatId) return;
    setMessages([]);
    syncRef.current = null;
    setVariantsByUserMessageId({});
  }, [activeChatId, setMessages, setVariantsByUserMessageId]);

  useEffect(() => {
    if (status !== "ready") return;
    if (createOpen) return;
    if (editOpen) return;
    if (settingsOpen) return;
    if (chatSettingsOpen) return;
    if (memorizeOpen) return;
    if (deleteChatOpen) return;
    if (adminOpen) return;
    if (profileSelectOpen) return;
    focusComposer({ toEnd: true });
  }, [
    activeChatId,
    adminOpen,
    chatSettingsOpen,
    createOpen,
    deleteChatOpen,
    editOpen,
    focusComposer,
    isTemporaryChat,
    memorizeOpen,
    profileSelectOpen,
    settingsOpen,
    status,
  ]);

  useEffect(() => {
    const onFocusRequested = () => {
      if (status !== "ready") return;
      if (createOpen) return;
      if (editOpen) return;
      if (settingsOpen) return;
      if (chatSettingsOpen) return;
      if (memorizeOpen) return;
      if (deleteChatOpen) return;
      if (adminOpen) return;
      if (profileSelectOpen) return;
      focusComposer({ toEnd: true });
    };

    window.addEventListener("remcochat:focus-composer", onFocusRequested);
    return () => {
      window.removeEventListener("remcochat:focus-composer", onFocusRequested);
    };
  }, [
    adminOpen,
    chatSettingsOpen,
    createOpen,
    deleteChatOpen,
    editOpen,
    focusComposer,
    memorizeOpen,
    profileSelectOpen,
    settingsOpen,
    status,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      // Let dialogs handle Escape, and avoid surprising actions while a dialog is open.
      if (
        createOpen ||
        editOpen ||
        settingsOpen ||
        chatSettingsOpen ||
        memorizeOpen ||
        deleteChatOpen ||
        adminOpen ||
        profileSelectOpen
      ) {
        return;
      }

      // Stop streaming.
      if (e.key === "Escape") {
        if (status === "submitted" || status === "streaming") {
          e.preventDefault();
          stop();
        }
        return;
      }

      const key = e.key.toLowerCase();

      // New chat.
      // Use Shift to avoid conflicting with the browser's native Cmd/Ctrl+N (new window).
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && key === "n") {
        e.preventDefault();
        createChat();
        return;
      }

      // Focus composer.
      if ((e.metaKey || e.ctrlKey) && (key === "/" || key === "?")) {
        e.preventDefault();
        focusComposer({ toEnd: true });
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    adminOpen,
    chatSettingsOpen,
    createChat,
    createOpen,
    deleteChatOpen,
    editOpen,
    focusComposer,
    memorizeOpen,
    profileSelectOpen,
    settingsOpen,
    status,
    stop,
  ]);

  useEffect(() => {
    if (!activeProfile) return;
    if (!activeChatId) return;
    if (isTemporaryChat) return;
    if (status !== "ready") return;
    if (error) return;
    if (loadedChatIdRef.current !== activeChatId) return;

    const signature = signatureForChatState(messages, variantsByUserMessageId);
    const last = syncRef.current;
    if (
      last?.profileId === activeProfile.id &&
      last?.chatId === activeChatId &&
      last?.signature === signature
    ) {
      return;
    }

    syncRef.current = {
      profileId: activeProfile.id,
      chatId: activeChatId,
      signature,
    };

    fetch(`/api/chats/${activeChatId}/messages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: activeProfile.id,
        messages,
        variantsByUserMessageId,
      }),
    })
      .then((r) =>
        r.ok
          ? refreshChats({
              profileId: activeProfile.id,
              preferChatId: activeChatId,
            })
          : null
      )
      .catch(() => {});
  }, [
    activeChatId,
    activeProfile,
    error,
    isTemporaryChat,
    messages,
    refreshChats,
    status,
    variantsByUserMessageId,
  ]);

  const regenerateLatest = useCallback(() => {
    if (status !== "ready") return;
    if (!chatRequestBody) return;
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "user") {
      // After a fork, the latest user message often has no assistant response yet.
      // `regenerate()` without a messageId will generate the assistant response for the last message.
      regenerate({ body: chatRequestBody }).catch(() => {});
      return;
    }

    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") {
        lastAssistantIndex = i;
        break;
      }
    }
    if (lastAssistantIndex < 0) return;

    const assistant = messages[lastAssistantIndex];
    if (!assistant) return;

    let lastUserId = "";
    for (let i = lastAssistantIndex; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === "user") {
        lastUserId = m.id;
        break;
      }
    }
    if (!lastUserId) return;

    setVariantsByUserMessageId((prev) => {
      const existing = prev[lastUserId] ?? [];
      const snapshot: UIMessage<RemcoChatMessageMetadata> = {
        ...assistant,
        id: nanoid(),
        metadata: {
          ...(assistant.metadata ?? {}),
          createdAt: new Date().toISOString(),
          turnUserMessageId: lastUserId,
        },
      };
      return { ...prev, [lastUserId]: [...existing, snapshot] };
    });

    regenerate({
      messageId: assistant.id,
      body: {
        ...chatRequestBody,
        regenerate: true,
        regenerateMessageId: assistant.id,
      },
    }).catch(() => {});
  }, [chatRequestBody, messages, regenerate, setVariantsByUserMessageId, status]);

  const startEditUserMessage = useCallback(
    (message: UIMessage<RemcoChatMessageMetadata>) => {
      if (message.role !== "user") return;
      if (status !== "ready") return;
      if (isTemporaryChat) return;

      const textPart = message.parts.find((p) => p.type === "text") as
        | { type: "text"; text: string }
        | undefined;

      setEditingMessageId(message.id);
      setEditText(textPart?.text ?? "");
      setEditError(null);
      setEditOpen(true);
    },
    [isTemporaryChat, status]
  );

  const forkFromEdit = useCallback(async () => {
    if (!activeProfile) return;
    if (!activeChatId) return;
    if (isTemporaryChat) return;
    if (!editingMessageId) return;
    if (!editText.trim()) return;
    if (editing) return;

    setEditing(true);
    setEditError(null);
    try {
      // Ensure the source chat state (including variants) is persisted before forking,
      // otherwise the server-side fork may miss locally-created variants.
      const persistRes = await fetch(`/api/chats/${activeChatId}/messages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfile.id,
          messages,
          variantsByUserMessageId,
        }),
      });
      if (!persistRes.ok) {
        const data = (await persistRes.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || "Failed to persist chat state.");
      }

      const res = await fetch(`/api/chats/${activeChatId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfile.id,
          userMessageId: editingMessageId,
          text: editText,
        }),
      });

      const data = (await res.json()) as { chat?: Chat; error?: string };
      if (!res.ok || !data.chat) {
        throw new Error(data.error || "Failed to fork chat.");
      }

      setChats((prev) => {
        const without = prev.filter((c) => c.id !== data.chat!.id);
        return [data.chat!, ...without];
      });
      setActiveChatId(data.chat.id);
      setEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to fork chat.");
    } finally {
      setEditing(false);
    }
  }, [
    activeChatId,
    activeProfile,
    editText,
    editing,
    editingMessageId,
    isTemporaryChat,
    messages,
    variantsByUserMessageId,
  ]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (!activeProfile) return;

    setSettingsError(null);
    setProfileInstructionsDraft(activeProfile.customInstructions ?? "");
    setMemoryEnabledDraft(Boolean(activeProfile.memoryEnabled));

    fetch(`/api/profiles/${activeProfile.id}/memory`)
      .then((r) => r.json())
      .then((data: { memory?: MemoryItem[] }) => {
        setMemoryItems(Array.isArray(data.memory) ? data.memory : []);
      })
      .catch(() => {});
  }, [activeProfile, settingsOpen]);

  const saveProfileSettings = useCallback(async () => {
    if (!activeProfile) return;
    if (settingsSaving) return;

    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const res = await fetch(`/api/profiles/${activeProfile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customInstructions: profileInstructionsDraft,
          memoryEnabled: memoryEnabledDraft,
        }),
      });

      const data = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "Failed to save profile settings.");
      }

      setProfiles((prev) =>
        prev.map((p) => (p.id === data.profile!.id ? data.profile! : p))
      );
      setSettingsOpen(false);
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : "Failed to save profile settings."
      );
    } finally {
      setSettingsSaving(false);
    }
  }, [activeProfile, memoryEnabledDraft, profileInstructionsDraft, settingsSaving]);

  const deleteMemory = useCallback(
    async (memoryId: string) => {
      if (!activeProfile) return;
      await fetch(`/api/profiles/${activeProfile.id}/memory/${memoryId}`, {
        method: "DELETE",
      }).catch(() => {});
      setMemoryItems((prev) => prev.filter((m) => m.id !== memoryId));
    },
    [activeProfile]
  );

  const confirmDeleteProfile = useCallback(async () => {
    if (!activeProfile) return;
    if (deleteProfileSaving) return;
    if (status !== "ready") return;

    const confirm = deleteProfileConfirm.trim();
    if (!confirm) return;

    setDeleteProfileSaving(true);
    setDeleteProfileError(null);
    try {
      const res = await fetch(`/api/profiles/${activeProfile.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; profiles?: Profile[]; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete profile.");
      }

      setDeleteProfileOpen(false);
      setSettingsOpen(false);
      await refreshProfiles();
    } catch (err) {
      setDeleteProfileError(
        err instanceof Error ? err.message : "Failed to delete profile."
      );
    } finally {
      setDeleteProfileSaving(false);
    }
  }, [
    activeProfile,
    deleteProfileConfirm,
    deleteProfileSaving,
    refreshProfiles,
    status,
  ]);

  const openChatSettings = useCallback(() => {
    if (status !== "ready") return;
    if (isTemporaryChat) return;
    const chatId = activeChat?.id ?? "";
    if (!chatId) return;
    setChatSettingsChatId(chatId);
    setChatSettingsOpen(true);
  }, [activeChat?.id, isTemporaryChat, status]);

  useEffect(() => {
    if (!chatSettingsOpen) return;
    setChatSettingsError(null);
    const target =
      chats.find((c) => c.id === chatSettingsChatId) ?? activeChat;
    setChatInstructionsDraft(target?.chatInstructions ?? "");
  }, [activeChat, chatSettingsChatId, chatSettingsOpen, chats]);

  const saveChatSettings = useCallback(async () => {
    const targetChatId = chatSettingsChatId || activeChat?.id || "";
    if (!targetChatId) return;
    if (chatSettingsSaving) return;

    setChatSettingsSaving(true);
    setChatSettingsError(null);
    try {
      const res = await fetch(`/api/chats/${targetChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatInstructions: chatInstructionsDraft }),
      });

      const data = (await res.json()) as { chat?: Chat; error?: string };
      if (!res.ok || !data.chat) {
        throw new Error(data.error || "Failed to save chat settings.");
      }

      setChats((prev) =>
        prev.map((c) => (c.id === data.chat!.id ? data.chat! : c))
      );
      if (activeProfile) {
        refreshChats({ profileId: activeProfile.id, preferChatId: data.chat!.id }).catch(
          () => {}
        );
      }
      setChatSettingsChatId("");
      setChatSettingsOpen(false);
    } catch (err) {
      setChatSettingsError(
        err instanceof Error ? err.message : "Failed to save chat settings."
      );
    } finally {
      setChatSettingsSaving(false);
    }
  }, [
    activeProfile,
    chatInstructionsDraft,
    chatSettingsChatId,
    chatSettingsSaving,
    refreshChats,
  ]);

  const toggleTemporaryChat = useCallback(() => {
    stop();
    setVariantsByUserMessageId({});
    setMessages([]);
    syncRef.current = null;
    loadedChatIdRef.current = "";

    setIsTemporaryChat((prev) => {
      const next = !prev;
      if (next) {
        setTemporarySessionId(nanoid());
        setTemporaryModelId(effectiveModelId);
      }
      return next;
    });
  }, [effectiveModelId, setMessages, setVariantsByUserMessageId, stop]);

  const startMemorize = useCallback(
    (message: UIMessage<RemcoChatMessageMetadata>) => {
      if (!activeProfile) return;
      if (isTemporaryChat) return;
      if (!activeProfile.memoryEnabled) return;

      const text = message.parts
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("\n")
        .trim();

      setMemorizeText(text);
      setMemorizeError(null);
      setMemorizeOpen(true);
    },
    [activeProfile, isTemporaryChat]
  );

  const saveMemorize = useCallback(async () => {
    if (!activeProfile) return;
    if (isTemporaryChat) return;
    if (!activeProfile.memoryEnabled) return;
    if (!memorizeText.trim()) return;
    if (memorizeSaving) return;

    setMemorizeSaving(true);
    setMemorizeError(null);
    try {
      const res = await fetch(`/api/profiles/${activeProfile.id}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: memorizeText }),
      });

      const data = (await res.json()) as { item?: MemoryItem; error?: string };
      if (!res.ok || !data.item) {
        throw new Error(data.error || "Failed to save memory.");
      }

      setMemoryItems((prev) => [data.item!, ...prev]);
      setMemorizeOpen(false);
    } catch (err) {
      setMemorizeError(
        err instanceof Error ? err.message : "Failed to save memory."
      );
    } finally {
      setMemorizeSaving(false);
    }
  }, [activeProfile, isTemporaryChat, memorizeSaving, memorizeText]);

  return (
    <div className="h-dvh w-full overflow-hidden bg-background text-foreground">
      <div className="grid h-full min-h-0 grid-cols-[18rem_1fr]">
        <aside className="flex min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="font-semibold tracking-tight">RemcoChat</div>
            <ThemeToggle />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="flex items-center justify-between gap-2 px-2 py-2">
              <div className="text-xs font-medium text-muted-foreground">
                Chats
	              </div>
	              <Button
	                aria-label="New chat"
	                className="h-7 w-7 px-0"
	                data-testid="sidebar:new-chat"
	                onClick={() => createChat()}
	                title="New chat"
	                type="button"
	                variant="secondary"
	              >
	                <PlusIcon className="size-4" />
	              </Button>
	            </div>

            <div className="space-y-1 px-1 pb-2" data-testid="sidebar:chats-active">
              {chats
                .filter((c) => !c.archivedAt)
                .map((chat) => (
                  <div
                    className={
                      "group flex items-center gap-1 rounded-md transition-colors " +
                      (chat.id === activeChatId && !isTemporaryChat
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/70")
                    }
                    key={chat.id}
                  >
                    <button
                      className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
                      data-testid={`sidebar:chat:${chat.id}`}
                      onClick={() => {
                        setIsTemporaryChat(false);
                        setActiveChatId(chat.id);
                      }}
                      type="button"
                    >
                      <div className="truncate">
                        {chat.title.trim() ? chat.title : "New chat"}
                      </div>
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="h-8 w-8 shrink-0 px-0 opacity-60 transition-opacity group-hover:opacity-100"
                          data-testid={`sidebar:chat-menu:${chat.id}`}
                          disabled={!activeProfile || status !== "ready"}
                          suppressHydrationWarning
                          type="button"
                          variant="ghost"
                        >
                          <MoreVerticalIcon className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          data-testid={`chat-action:archive:${chat.id}`}
                          onClick={() => archiveChatById(chat.id)}
                        >
                          <ArchiveIcon />
                          Archive
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          data-testid={`chat-action:export-md:${chat.id}`}
                          onClick={() => exportChatById(chat.id, "md")}
                        >
                          <DownloadIcon />
                          Export Markdown
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          data-testid={`chat-action:export-json:${chat.id}`}
                          onClick={() => exportChatById(chat.id, "json")}
                        >
                          <DownloadIcon />
                          Export JSON
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          data-testid={`chat-action:delete:${chat.id}`}
                          onClick={() => startDeleteChat(chat)}
                          variant="destructive"
                        >
                          <Trash2Icon />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
            </div>

            {chats.some((c) => Boolean(c.archivedAt)) ? (
              <div className="pt-2">
                <Collapsible onOpenChange={setArchivedOpen} open={archivedOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      className="flex w-full items-center justify-between gap-2 px-3 pb-1 text-left text-xs font-medium text-muted-foreground"
                      data-testid="sidebar:archived-toggle"
                      suppressHydrationWarning
                      type="button"
                    >
                      <span>
                        Archived ({chats.filter((c) => Boolean(c.archivedAt)).length})
                      </span>
                      <ChevronDownIcon
                        className={
                          "size-3 transition-transform " +
                          (archivedOpen ? "rotate-180" : "")
                        }
                      />
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div
                      className="space-y-1 px-1 pb-2"
                      data-testid="sidebar:chats-archived"
                    >
                      {chats
                        .filter((c) => Boolean(c.archivedAt))
                        .map((chat) => (
                          <div
                            className={
                              "group flex items-center gap-1 rounded-md transition-colors " +
                              (chat.id === activeChatId && !isTemporaryChat
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "hover:bg-sidebar-accent/70")
                            }
                            key={chat.id}
                          >
                            <button
                              className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
                              data-testid={`sidebar:archived-chat:${chat.id}`}
                              onClick={() => {
                                setIsTemporaryChat(false);
                                setActiveChatId(chat.id);
                              }}
                              type="button"
                            >
                              <div className="truncate">
                                {chat.title.trim() ? chat.title : "New chat"}
                              </div>
                            </button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  className="h-8 w-8 shrink-0 px-0 opacity-60 transition-opacity group-hover:opacity-100"
                                  data-testid={`sidebar:archived-chat-menu:${chat.id}`}
                                  disabled={!activeProfile || status !== "ready"}
                                  suppressHydrationWarning
                                  type="button"
                                  variant="ghost"
                                >
                                  <MoreVerticalIcon className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  data-testid={`chat-action:unarchive:${chat.id}`}
                                  onClick={() => unarchiveChatById(chat.id)}
                                >
                                  <Undo2Icon />
                                  Unarchive
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  data-testid={`chat-action:export-md:${chat.id}`}
                                  onClick={() => exportChatById(chat.id, "md")}
                                >
                                  <DownloadIcon />
                                  Export Markdown
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  data-testid={`chat-action:export-json:${chat.id}`}
                                  onClick={() => exportChatById(chat.id, "json")}
                                >
                                  <DownloadIcon />
                                  Export JSON
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  data-testid={`chat-action:delete:${chat.id}`}
                                  onClick={() => startDeleteChat(chat)}
                                  variant="destructive"
                                >
                                  <Trash2Icon />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ) : null}
          </div>

          <div className="border-t p-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Profile
            </div>
            <div className="flex items-center gap-2">
              <Select
                onOpenChange={(open) => {
                  setProfileSelectOpen(open);
                  if (open) return;
                  window.setTimeout(() => focusComposer({ toEnd: true }), 0);
                }}
                onValueChange={setActiveProfileId}
                value={activeProfile?.id ?? ""}
              >
                <SelectTrigger
                  className="h-9 flex-1"
                  data-testid="profile:select-trigger"
                  suppressHydrationWarning
                >
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

	              <Button
	                aria-label="New profile"
	                className="h-9 w-9 px-0"
	                data-testid="profile:new"
	                onClick={() => setCreateOpen(true)}
	                title="New profile"
	                type="button"
	                variant="secondary"
	              >
	                <PlusIcon className="size-4" />
	              </Button>
	            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                className="h-9 w-full justify-start gap-2"
                data-testid="profile:settings-open"
                disabled={status !== "ready"}
                onClick={() => setSettingsOpen(true)}
                type="button"
                variant="ghost"
              >
                <SettingsIcon className="size-4" />
                <span>Settings</span>
              </Button>
            </div>

	            {adminEnabled ? (
	              <div className="mt-2">
	                <Button
	                  className="h-9 w-full justify-start gap-2"
	                  data-testid="admin:open"
	                  disabled={status !== "ready"}
	                  onClick={() => setAdminOpen(true)}
	                  type="button"
	                  variant="ghost"
	                >
	                  <ShieldIcon className="size-4" />
	                  <span>Admin</span>
	                </Button>
	              </div>
	            ) : null}

	            {appVersion ? (
	              <div
	                className="mt-3 text-[11px] text-muted-foreground"
	                data-testid="app:version"
	              >
	                v{appVersion}
	              </div>
	            ) : null}
	          </div>
	        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="shrink-0 text-sm text-muted-foreground">Model</div>
              <ModelPicker
                className="min-w-0"
                onChange={(modelId) => {
                  if (activeProfile && isAllowedModel(modelId)) {
                    window.localStorage.setItem(
                      lastUsedModelKey(activeProfile.id),
                      modelId
                    );
                  }
                  if (isTemporaryChat) {
                    if (isAllowedModel(modelId)) setTemporaryModelId(modelId);
                    return;
                  }
                  setChatModel(modelId);
                }}
                options={MODEL_ALLOWLIST}
                triggerTestId="model:picker-trigger"
                value={effectiveModelId}
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground">
                {isTemporaryChat ? "Temporary chat" : getModelLabel(effectiveModelId)}
              </div>
              <Button
                aria-label={isTemporaryChat ? "Exit temporary chat" : "Enter temporary chat"}
	                className={
	                  "h-8 w-9 px-0 " +
	                  (isTemporaryChat
	                    ? "border-destructive/50 text-destructive bg-destructive/5 hover:bg-destructive/10 focus-visible:border-destructive focus-visible:ring-destructive/30 dark:border-destructive/50 dark:text-destructive dark:bg-destructive/10 dark:hover:bg-destructive/15 dark:focus-visible:border-destructive dark:focus-visible:ring-destructive/40"
		                    : "border-ring/50 text-ring bg-transparent hover:bg-muted hover:text-ring focus-visible:border-ring focus-visible:ring-ring/30 dark:border-ring/50 dark:bg-input/30 dark:hover:bg-input/50 dark:hover:text-ring")
		                }
                data-testid="chat:temporary-toggle"
                onClick={() => toggleTemporaryChat()}
                title={isTemporaryChat ? "Temporary chat (on)" : "Temporary chat (off)"}
                type="button"
                variant="outline"
              >
                {isTemporaryChat ? (
                  <LockIcon className="size-4" />
                ) : (
                  <LockOpenIcon className="size-4" />
                )}
              </Button>
            </div>
          </header>

          <StickToBottom
            className="min-h-0 flex-1 overflow-hidden"
            initial="instant"
            resize="smooth"
          >
            <StickToBottom.Content className="w-full px-6 py-8">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {messages.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground">
                    Start a chat.
                  </div>
                ) : null}

                {(() => {
                  let lastUserMessageId: string | null = null;

                  return messages.map(({ id, role, parts, metadata }) => {
                    if (role === "user") lastUserMessageId = id;

                    const hasMemoryAnswerCard =
                      role === "assistant" &&
                      parts.some((p) => p.type === "tool-displayMemoryAnswer");

                    const turnUserMessageId =
                      role === "assistant"
                        ? metadata?.turnUserMessageId ?? lastUserMessageId
                        : null;

                    const variants = turnUserMessageId
                      ? variantsByUserMessageId[turnUserMessageId] ?? []
                      : [];

                    const sortedVariants =
                      role === "assistant"
                        ? [
                            ({ id, role, parts, metadata } satisfies UIMessage<RemcoChatMessageMetadata>),
                            ...variants,
                          ].sort((a, b) => {
                            const aAt = a.metadata?.createdAt ?? "";
                            const bAt = b.metadata?.createdAt ?? "";
                            if (aAt < bAt) return -1;
                            if (aAt > bAt) return 1;
                            return a.id.localeCompare(b.id);
                          })
                        : [];

                    const variantIndex =
                      sortedVariants.length > 0
                        ? sortedVariants.findIndex((m) => m.id === id)
                        : -1;

                    const canPageVariants =
                      role === "assistant" &&
                      turnUserMessageId &&
                      sortedVariants.length > 1 &&
                      variantIndex >= 0;

                    const selectVariant = (targetId: string) => {
                      if (!turnUserMessageId) return;
                      if (targetId === id) return;

                      const target = variants.find((m) => m.id === targetId);
                      if (!target) return;

                      setMessages((prev) =>
                        prev.map((m) => (m.id === id ? target : m))
                      );
                      setVariantsByUserMessageId((prev) => {
                        const current = prev[turnUserMessageId] ?? [];
                        const next = current
                          .filter((m) => m.id !== targetId)
                          .concat([
                            {
                              id,
                              role: "assistant",
                              parts,
                              metadata,
                            } satisfies UIMessage<RemcoChatMessageMetadata>,
                          ]);
                        return { ...prev, [turnUserMessageId]: next };
                      });
                    };

                    return (
                      <Message
                        data-testid={`message:${role}:${id}`}
                        from={role}
                        key={id}
                      >
                        <MessageContent>
                          {parts.map((part, index) => {
                            if (part.type === "text") {
                              if (hasMemoryAnswerCard) return null;
                              return (
                                <MessageResponse
                                  className="prose-neutral dark:prose-invert"
                                  key={`${id}-${index}`}
                                >
                                  {part.text}
                                </MessageResponse>
                              );
                            }

                            if (part.type === "tool-displayMemoryAnswer") {
                              switch (part.state) {
                                case "input-available":
                                  return (
                                    <div
                                      className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                                      key={`${id}-${index}`}
                                    >
                                      <Loader size={14} />
                                      Retrieving from memory…
                                    </div>
                                  );
                                case "output-available":
                                  return (
                                    <div key={`${id}-${index}`}>
                                      <MemoryCard
                                        answer={
                                          typeof (part.output as { answer?: unknown })
                                            ?.answer === "string"
                                            ? (part.output as { answer: string }).answer
                                            : ""
                                        }
                                      />
                                    </div>
                                  );
                                case "output-error":
                                  return (
                                    <div
                                      className="text-sm text-destructive"
                                      key={`${id}-${index}`}
                                    >
                                      Memory error: {part.errorText}
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayWeather") {
                              switch (part.state) {
                                case "input-available":
                                  return (
                                    <div
                                      className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                                      key={`${id}-${index}`}
                                    >
                                      <Loader size={14} />
                                      Fetching weather…
                                    </div>
                                  );
                                case "output-available":
                                  return (
                                    <div key={`${id}-${index}`}>
                                      <Weather {...(part.output as WeatherToolOutput)} />
                                    </div>
                                  );
                                case "output-error":
                                  return (
                                    <div
                                      className="text-sm text-destructive"
                                      key={`${id}-${index}`}
                                    >
                                      Weather error: {part.errorText}
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayWeatherForecast") {
                              switch (part.state) {
                                case "input-available":
                                  return (
                                    <div
                                      className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                                      key={`${id}-${index}`}
                                    >
                                      <Loader size={14} />
                                      Fetching forecast…
                                    </div>
                                  );
                                case "output-available":
                                  return (
                                    <div key={`${id}-${index}`}>
                                      <WeatherForecast
                                        {...(part.output as WeatherForecastToolOutput)}
                                      />
                                    </div>
                                  );
                                case "output-error":
                                  return (
                                    <div
                                      className="text-sm text-destructive"
                                      key={`${id}-${index}`}
                                    >
                                      Forecast error: {part.errorText}
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            return null;
                          })}
                        </MessageContent>

	                        {role === "user" ? (
	                          <MessageActions className="justify-end opacity-60 transition-opacity hover:opacity-100 group-hover:opacity-100">
	                            <MessageAction
	                              aria-label="Memorize this"
	                              data-testid={`message-action:memorize:${id}`}
	                              disabled={
	                                status !== "ready" ||
	                                isTemporaryChat ||
	                                !activeProfile?.memoryEnabled
	                              }
                              onClick={() =>
                                startMemorize({
                                  id,
                                  role,
                                  parts,
                                  metadata,
                                })
                              }
                              tooltip="Memorize this"
                            >
                              <BookmarkIcon />
                            </MessageAction>
	                            <MessageAction
	                              aria-label="Edit message"
	                              data-testid={`message-action:edit:${id}`}
	                              disabled={status !== "ready" || isTemporaryChat}
	                              onClick={() =>
	                                startEditUserMessage({
	                                  id,
	                                  role,
                                  parts,
                                  metadata,
                                })
                              }
                              tooltip="Edit & fork"
                            >
                              <PencilIcon />
                            </MessageAction>
                          </MessageActions>
                        ) : null}

                        {canPageVariants ? (
                          <div
                            className="flex items-center justify-end gap-2 text-xs text-muted-foreground"
                            data-testid={`variants:pager:${id}`}
                          >
                            <button
                              className="rounded-md border px-2 py-1 hover:bg-accent"
                              data-testid={`variants:prev:${id}`}
                              onClick={() => {
                                const prevIndex =
                                  variantIndex > 0
                                    ? variantIndex - 1
                                    : sortedVariants.length - 1;
                                selectVariant(sortedVariants[prevIndex]!.id);
                              }}
                              type="button"
                            >
                              Prev
                            </button>
                            <div>
                              {variantIndex + 1} / {sortedVariants.length}
                            </div>
                            <button
                              className="rounded-md border px-2 py-1 hover:bg-accent"
                              data-testid={`variants:next:${id}`}
                              onClick={() => {
                                const nextIndex =
                                  variantIndex < sortedVariants.length - 1
                                    ? variantIndex + 1
                                    : 0;
                                selectVariant(sortedVariants[nextIndex]!.id);
                              }}
                              type="button"
                            >
                              Next
                            </button>
                          </div>
                        ) : null}
                      </Message>
                    );
                  });
                })()}

                {showThinking ? (
                  <Message data-testid="chat:thinking-indicator" from="assistant">
                    <MessageContent>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader size={14} />
                        <span>Thinking…</span>
                      </div>
                    </MessageContent>
                  </Message>
                ) : null}

                {error ? (
                  <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
                    <div>Something went wrong.</div>
                    <button
                      className="mt-2 underline underline-offset-4"
                      onClick={() => {
                        if (!chatRequestBody) return;
                        regenerate({ body: chatRequestBody }).catch(() => {});
                      }}
                      type="button"
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
              </div>
            </StickToBottom.Content>
          </StickToBottom>

	          <div className="shrink-0 border-t bg-background px-6 py-4">
	            <div className="mx-auto w-full max-w-3xl">
	              <PromptInput
	                className={
	                  "bg-card " +
	                  (isTemporaryChat
	                    ? "[&_[data-slot=input-group]]:border-destructive [&_[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:border-destructive [&_[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:ring-destructive/30"
	                    : "")
	                }
	                onSubmit={({ text }) => {
	                  if (!activeProfile) return;
	                  if (status !== "ready") return;
	                  if (!text.trim()) return;
                  if (!chatRequestBody) return;

                  sendMessage(
                    { text, metadata: { createdAt: new Date().toISOString() } },
                    {
                      body: chatRequestBody,
                    }
                  );
                  setInput("");
                }}
              >
                <PromptInputTextarea
                  className="max-h-[30vh] overflow-y-auto"
                  data-testid="composer:textarea"
                  name="message"
                  onChange={(e) => setInput(e.target.value)}
                  value={input}
                />
                <div className="flex items-center justify-end gap-2 pr-2">
                  {status === "ready" && messages.some((m) => m.role === "user") ? (
                    <button
                      aria-label="Regenerate"
                      className="inline-flex size-10 items-center justify-center rounded-md border text-sm hover:bg-accent"
                      data-testid="composer:regenerate"
                      onClick={() => regenerateLatest()}
                      title="Regenerate"
                      type="button"
                    >
                      <RotateCcwIcon className="size-4" />
                    </button>
                  ) : null}
                  {!isTemporaryChat && activeChat ? (
                    <button
                      aria-label="Chat settings"
                      className="inline-flex size-10 items-center justify-center rounded-md border text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                      data-testid="chat:settings-open"
                      disabled={status !== "ready"}
                      onClick={() => openChatSettings()}
                      title="Chat settings"
                      type="button"
                    >
                      <SlidersHorizontalIcon className="size-4" />
                    </button>
                  ) : null}
                  {(status === "submitted" || status === "streaming") && (
                    <button
                      className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
                      onClick={() => stop()}
                      type="button"
                    >
                      Stop
                    </button>
                  )}
	                  <PromptInputSubmit
	                    className="h-10 w-16"
	                    data-testid="composer:submit"
	                    disabled={!canSend}
	                    status={status}
	                    variant={isTemporaryChat ? "destructive" : "default"}
	                  />
	                </div>
	              </PromptInput>
	            </div>
	          </div>
        </main>
      </div>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New profile</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              autoFocus
              data-testid="profile:create-name"
              onChange={(e) => setNewProfileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createProfile();
                }
              }}
              placeholder="Profile name"
              value={newProfileName}
            />

            {createError ? (
              <div className="text-sm text-destructive">{createError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="profile:create-cancel"
                onClick={() => setCreateOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                data-testid="profile:create-submit"
                disabled={!newProfileName.trim() || creating}
                onClick={() => createProfile()}
                type="button"
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

	      <Dialog onOpenChange={setEditOpen} open={editOpen}>
	        <DialogContent>
	          <DialogHeader>
	            <DialogTitle>Edit message (fork)</DialogTitle>
	          </DialogHeader>

	          <div className="space-y-3">
	            <Textarea
	              autoFocus
	              className="min-h-[8rem] max-h-[40vh]"
	              data-testid="edit:textarea"
	              onChange={(e) => setEditText(e.target.value)}
	              value={editText}
	            />

            {editError ? (
              <div className="text-sm text-destructive">{editError}</div>
            ) : null}

	            <div className="flex justify-end gap-2">
	              <Button
	                disabled={editing}
	                data-testid="edit:cancel"
	                onClick={() => setEditOpen(false)}
	                type="button"
	                variant="ghost"
	              >
	                Cancel
	              </Button>
	              <Button
	                disabled={!editText.trim() || editing}
	                data-testid="edit:fork-submit"
	                onClick={() => forkFromEdit()}
	                type="button"
	              >
	                Fork chat
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

	      <Dialog onOpenChange={setSettingsOpen} open={settingsOpen}>
	        <DialogContent
            className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_1fr] overflow-hidden sm:max-w-md"
            data-testid="profile:settings-dialog"
          >
	          <DialogHeader>
	            <DialogTitle>Profile settings</DialogTitle>
	          </DialogHeader>

	          <div className="min-h-0 overflow-y-auto pr-1">
              <div className="space-y-4 pr-3">
	              <div className="space-y-2">
	                <div className="text-sm font-medium">Custom instructions</div>
	                <Textarea
	                  className="min-h-[8rem]"
	                  data-testid="profile:instructions"
	                  onChange={(e) => setProfileInstructionsDraft(e.target.value)}
	                  placeholder="How should RemcoChat behave for this profile?"
	                  value={profileInstructionsDraft}
	                />
	              </div>

	            <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
	              <div>
	                <div className="text-sm font-medium">Memory</div>
	                <div className="text-xs text-muted-foreground">
	                  Only saved via “Memorize this”.
	                </div>
	              </div>
	              <button
	                aria-checked={memoryEnabledDraft}
	                aria-label="Toggle memory"
	                className={
	                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors " +
	                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
	                  (memoryEnabledDraft ? "bg-primary" : "bg-muted")
	                }
	                data-testid="profile:memory-toggle"
	                onClick={() => setMemoryEnabledDraft((v) => !v)}
	                role="switch"
	                title={memoryEnabledDraft ? "Memory: On" : "Memory: Off"}
	                type="button"
	              >
	                <span
	                  className={
	                    "pointer-events-none inline-block size-5 rounded-full bg-white shadow-sm transition-transform " +
	                    (memoryEnabledDraft ? "translate-x-5" : "translate-x-0.5")
	                  }
	                />
	              </button>
	            </div>

            {memoryEnabledDraft ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">Saved memories</div>
                {memoryItems.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No memories yet.
                  </div>
                ) : (
	                  <div className="space-y-2">
	                    {memoryItems.map((m) => (
	                      <div
	                        className="flex items-start justify-between gap-3 rounded-md border bg-card p-3"
	                        key={m.id}
	                      >
	                        <div
                            className="min-w-0 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]"
                            data-testid="profile:memory-item"
                          >
	                          {m.content}
	                        </div>
	                        <Button
	                          className="h-8 shrink-0 px-2"
	                          onClick={() => deleteMemory(m.id)}
	                          type="button"
	                          variant="ghost"
	                        >
                          Delete
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {settingsError ? (
              <div className="text-sm text-destructive">{settingsError}</div>
            ) : null}

            <div className="rounded-md border border-destructive/30 bg-card p-3">
              <div className="text-sm font-medium">Danger zone</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Deleting a profile deletes all its chats, messages, and memories.
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  data-testid="profile:delete-open"
                  disabled={!activeProfile || status !== "ready"}
                  onClick={() => setDeleteProfileOpen(true)}
                  type="button"
                  variant="destructive"
                >
                  Delete profile
                </Button>
              </div>
            </div>

	              <div className="flex justify-end gap-2">
	                <Button
	                  disabled={settingsSaving}
	                  data-testid="profile:settings-cancel"
	                  onClick={() => setSettingsOpen(false)}
	                  type="button"
	                  variant="ghost"
	                >
	                  Cancel
	                </Button>
	                <Button
	                  disabled={settingsSaving}
	                  data-testid="profile:settings-save"
	                  onClick={() => saveProfileSettings()}
	                  type="button"
	                >
	                  Save
	                </Button>
	              </div>
	            </div>
	          </div>
	        </DialogContent>
	      </Dialog>

      <Dialog onOpenChange={setDeleteProfileOpen} open={deleteProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete profile</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              This cannot be undone. Type{" "}
              <span className="font-medium text-foreground">
                {activeProfile?.name ?? "the profile name"}
              </span>{" "}
              (or <span className="font-medium text-foreground">DELETE</span>) to
              confirm.
            </div>

            <Input
              autoFocus
              data-testid="profile:delete-confirm-input"
              onChange={(e) => setDeleteProfileConfirm(e.target.value)}
              placeholder="Type profile name or DELETE"
              value={deleteProfileConfirm}
            />

            {deleteProfileError ? (
              <div className="text-sm text-destructive">{deleteProfileError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="profile:delete-cancel"
                disabled={deleteProfileSaving}
                onClick={() => setDeleteProfileOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                data-testid="profile:delete-submit"
                disabled={
                  deleteProfileSaving ||
                  !activeProfile ||
                  status !== "ready" ||
                  (() => {
                    const v = deleteProfileConfirm.trim();
                    return !(v === "DELETE" || v === activeProfile.name);
                  })()
                }
                onClick={() => confirmDeleteProfile()}
                type="button"
                variant="destructive"
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setChatSettingsOpen} open={chatSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chat settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Applies starting with the next assistant response.
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Chat instructions</div>
              <Textarea
                className="min-h-[8rem]"
                data-testid="chat:instructions"
                onChange={(e) => setChatInstructionsDraft(e.target.value)}
                placeholder="Instructions applied only to this chat."
                value={chatInstructionsDraft}
              />
            </div>

            {chatSettingsError ? (
              <div className="text-sm text-destructive">{chatSettingsError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                disabled={chatSettingsSaving}
                data-testid="chat:settings-cancel"
                onClick={() => setChatSettingsOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                disabled={chatSettingsSaving}
                data-testid="chat:settings-save"
                onClick={() => saveChatSettings()}
                type="button"
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setMemorizeOpen} open={memorizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Memorize this</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              autoFocus
              className="min-h-[8rem]"
              onChange={(e) => setMemorizeText(e.target.value)}
              placeholder="What should RemcoChat remember?"
              value={memorizeText}
            />

            {memorizeError ? (
              <div className="text-sm text-destructive">{memorizeError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                disabled={memorizeSaving}
                onClick={() => setMemorizeOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                disabled={!memorizeText.trim() || memorizeSaving}
                onClick={() => saveMemorize()}
                type="button"
              >
                Save memory
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDeleteChatOpen} open={deleteChatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              This removes the chat from the sidebar. This action cannot be undone.
            </div>
            <div className="rounded-md border bg-card p-3 text-sm">
              {deleteChatTitle}
            </div>
          </div>

          {deleteChatError ? (
            <div className="text-sm text-destructive">{deleteChatError}</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              disabled={deleteChatSaving}
              onClick={() => setDeleteChatOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={deleteChatSaving}
              data-testid="chat:delete-confirm"
              onClick={() => confirmDeleteChat()}
              type="button"
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setAdminOpen} open={adminOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Backup</div>
              <div className="text-sm text-muted-foreground">
                Download a full JSON backup (profiles, chats, messages, variants,
                memory).
              </div>
              <div className="flex justify-end">
                <Button
                  data-testid="admin:export"
                  onClick={() => exportAllData()}
                  type="button"
                  variant="secondary"
                >
                  Export all data
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-card p-3">
              <div className="text-sm font-medium text-destructive">Danger zone</div>
              <div className="text-sm text-muted-foreground">
                This wipes the local database. Type <code>RESET</code> to enable
                the button.
              </div>
              <Input
                autoComplete="off"
                data-testid="admin:reset-confirm"
                onChange={(e) => setAdminResetConfirm(e.target.value)}
                placeholder="Type RESET"
                value={adminResetConfirm}
              />
              <div className="flex justify-end">
                <Button
                  data-testid="admin:reset"
                  disabled={adminResetConfirm !== "RESET" || adminResetSaving}
                  onClick={() => resetAllData()}
                  type="button"
                  variant="destructive"
                >
                  Reset all data
                </Button>
              </div>
            </div>

            {adminError ? (
              <div className="text-sm text-destructive">{adminError}</div>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={() => setAdminOpen(false)} type="button" variant="ghost">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
