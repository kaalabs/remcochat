"use client";

import {
  Message,
  MessageAttachment,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { ModelPicker } from "@/components/model-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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
import type { ModelOption } from "@/lib/models";
import { validateChatTitle } from "@/lib/chat-title";
import type {
  Chat,
  ChatFolder,
  AgendaToolOutput,
  ListsOverviewToolOutput,
  MemoryItem,
  Profile,
  RemcoChatMessageMetadata,
  TaskList,
  TaskListOverview,
} from "@/lib/types";
import {
  extractPromptHistory,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  navigatePromptHistory,
} from "@/lib/composer-history";
import { Loader } from "@/components/ai-elements/loader";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import { StickToBottom, type StickToBottomContext } from "use-stick-to-bottom";
import { MessageActions, MessageAction } from "@/components/ai-elements/message";
import { Weather } from "@/components/weather";
import { WeatherForecast } from "@/components/weather-forecast";
import { MemoryCard } from "@/components/memory-card";
import { ListCard } from "@/components/list-card";
	import { ListsOverviewCard } from "@/components/lists-overview-card";
	import { AgendaCard } from "@/components/agenda-card";
	import { CurrentDateTimeCard } from "@/components/current-date-time-card";
	import { MemoryPromptCard } from "@/components/memory-prompt-card";
	import { TimezonesCard } from "@/components/timezones-card";
import {
  allowedReasoningEfforts,
  normalizeReasoningEffort,
  type ReasoningEffortChoice,
} from "@/lib/reasoning-effort";
import { UrlSummaryCard } from "@/components/url-summary-card";
import { NotesCard } from "@/components/notes-card";
import { BashToolCard } from "@/components/bash-tool-card";
import { SkillsToolCard } from "@/components/skills-tool-card";
import { ConversationScrollButton } from "@/components/ai-elements/conversation";
	import type { WeatherToolOutput } from "@/ai/weather";
	import type { WeatherForecastToolOutput } from "@/ai/weather";
	import type { CurrentDateTimeToolOutput } from "@/ai/current-date-time";
	import type { TimezonesToolOutput } from "@/ai/timezones";
	import type { UrlSummaryToolOutput } from "@/ai/url-summary";
import type { NotesToolOutput } from "@/lib/types";
import {
		  ArchiveIcon,
		  BookmarkIcon,
		  ChevronDownIcon,
      FolderIcon,
      FolderOpenIcon,
      FolderPlusIcon,
      PinIcon,
      PinOffIcon,
		  ShieldIcon,
		  DownloadIcon,
      KeyIcon,
      MenuIcon,
		  MoreVerticalIcon,
		  PlusIcon,
		  PencilIcon,
      XIcon,
		  LockIcon,
		  LockOpenIcon,
		  RotateCcwIcon,
		  SettingsIcon,
		  SlidersHorizontalIcon,
	  Trash2Icon,
	  Undo2Icon,
      UsersIcon,
	} from "lucide-react";
import { nanoid } from "nanoid";
import Link from "next/link";
import { parseAttachmentUrl } from "@/lib/attachment-url";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY = "remcochat:lanAdminToken";
const REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY = "remcochat:lanAdminToken:session";

function chatIsPinned(chat: Pick<Chat, "pinnedAt">): boolean {
  return typeof chat.pinnedAt === "string" && chat.pinnedAt.trim().length > 0;
}

function compareChatsForSidebar(a: Chat, b: Chat): number {
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

function textLengthForMessage(message: UIMessage<RemcoChatMessageMetadata>) {
  return message.parts.reduce((acc, part) => {
    if (part.type === "text") return acc + part.text.length;
    return acc;
  }, 0);
}

function toolNameFromPartType(type: string) {
  return type.startsWith("tool-") ? type.slice("tool-".length) : type;
}

function ToolCallLine(props: { type: string; state?: string }) {
  const toolName = toolNameFromPartType(props.type);
  const showSpinner =
    props.state === "input-streaming" ||
    props.state === "input-available" ||
    props.state === "approval-requested";

  return (
    <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      {showSpinner ? <Loader size={14} /> : null}
      Calling tool: &quot;{toolName}&quot;
    </div>
  );
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

function requestFocusComposer(opts?: { toEnd?: boolean }) {
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
}

function ComposerAttachmentsCountBridge(props: {
  onCountChange: (count: number) => void;
}) {
  const attachments = usePromptInputAttachments();
  useEffect(() => {
    props.onCountChange(attachments.files.length);
  }, [attachments.files.length, props.onCountChange]);
  return null;
}

export type HomeClientProps = {
  adminEnabled: boolean;
  appVersion: string;
  bashToolsLanAccessEnabled: boolean;
  initialActiveProfileId: string;
  initialProfiles: Profile[];
  initialChats: Chat[];
};

export function HomeClient({
  adminEnabled,
  appVersion,
  bashToolsLanAccessEnabled,
  initialActiveProfileId,
  initialProfiles,
  initialChats,
}: HomeClientProps) {
  const initialProfileId =
    initialProfiles.some((p) => p.id === initialActiveProfileId)
      ? initialActiveProfileId
      : initialProfiles[0]?.id ?? "";
  const initialProfileDefaultModelId =
    initialProfiles.find((p) => p.id === initialProfileId)?.defaultModelId ??
    initialProfiles[0]?.defaultModelId ??
    "";

  const readLanAdminToken = useCallback((): string => {
    if (typeof window === "undefined") return "";
    const session = window.sessionStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY);
    if (session && session.trim()) return session.trim();
    const local = window.localStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY);
    if (local && local.trim()) return local.trim();
    return "";
  }, []);

  const writeLanAdminToken = useCallback(
    (token: string, remember: boolean) => {
      if (typeof window === "undefined") return;
      const trimmed = String(token ?? "").trim();

      if (!trimmed) {
        window.sessionStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY);
        window.localStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY);
        return;
      }

      if (remember) {
        window.localStorage.setItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY, trimmed);
        window.sessionStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY);
      } else {
        window.sessionStorage.setItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY, trimmed);
        window.localStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY);
      }
    },
    []
  );

  const clearLanAdminToken = useCallback(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY);
    window.localStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY);
  }, []);

  const stickToBottomContextRef = useRef<StickToBottomContext | null>(null);
  const scrollTranscriptToBottom = useCallback(
    (animation: "instant" | "smooth" = "instant") => {
      const ctx = stickToBottomContextRef.current;
      if (!ctx) return;
      void ctx.scrollToBottom(animation);
    },
    []
  );
  const queueScrollTranscriptToBottom = useCallback(
    (animation: "instant" | "smooth" = "instant") => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollTranscriptToBottom(animation))
      );
    },
    [scrollTranscriptToBottom]
  );

  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [activeProfileId, setActiveProfileId] = useState<string>(
    initialProfileId
  );
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>(
    initialChats[0]?.id ?? ""
  );
  const [variantsByUserMessageId, setVariantsByUserMessageId] = useState<
    Record<string, UIMessage<RemcoChatMessageMetadata>[]>
  >({});

  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const [temporarySessionId, setTemporarySessionId] = useState(() => nanoid());
  const [temporaryModelId, setTemporaryModelId] = useState<string>(
    () => initialProfileDefaultModelId
  );

  const [lanAdminTokenOpen, setLanAdminTokenOpen] = useState(false);
  const [lanAdminTokenDraft, setLanAdminTokenDraft] = useState("");
  const [lanAdminTokenRemember, setLanAdminTokenRemember] = useState(false);
  const [lanAdminTokenVisible, setLanAdminTokenVisible] = useState(false);
  const [hasLanAdminToken, setHasLanAdminToken] = useState(false);
  const [bashToolsEnabledHeader, setBashToolsEnabledHeader] = useState<
    "0" | "1" | null
  >(null);

  useEffect(() => {
    if (!bashToolsLanAccessEnabled) return;
    const token = readLanAdminToken();
    setHasLanAdminToken(Boolean(token));
    setLanAdminTokenDraft(token);
    if (typeof window !== "undefined") {
      const remember = Boolean(
        !window.sessionStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY) &&
          window.localStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY)
      );
      setLanAdminTokenRemember(remember);
    }
  }, [bashToolsLanAccessEnabled, readLanAdminToken]);

  const instrumentedChatFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await globalThis.fetch(input, init);
      const header = response.headers.get("x-remcochat-bash-tools-enabled");
      if (header === "0" || header === "1") setBashToolsEnabledHeader(header);
      return response;
    },
    []
  );

  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: "/api/chat",
      fetch: instrumentedChatFetch,
      headers: () => {
        const headers: Record<string, string> = {};
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) headers["x-remcochat-viewer-timezone"] = tz;
        if (!bashToolsLanAccessEnabled) return headers;
        const token = readLanAdminToken();
        if (token) headers["x-remcochat-admin-token"] = token;
        return headers;
      },
    });
  }, [bashToolsLanAccessEnabled, instrumentedChatFetch, readLanAdminToken]);

  type ProvidersResponse = {
    defaultProviderId: string;
    activeProviderId: string;
    webToolsEnabled: boolean;
    providers: Array<{
      id: string;
      name: string;
      defaultModelId: string;
      models: ModelOption[];
    }>;
  };

  const [providersConfig, setProvidersConfig] =
    useState<ProvidersResponse | null>(null);

  useEffect(() => {
    let canceled = false;
    fetch("/api/providers")
      .then((res) => res.json())
      .then((data: ProvidersResponse) => {
        if (canceled) return;
        setProvidersConfig(data);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("remcochat:profileId");
    if (!stored) return;
    if (stored === activeProfileId) return;
    if (!profiles.some((p) => p.id === stored)) return;
    setActiveProfileId(stored);
    setChats([]);
    setActiveChatId("");
    setVariantsByUserMessageId({});
    setIsTemporaryChat(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeProfileId) return;
    window.localStorage.setItem("remcochat:profileId", activeProfileId);
    try {
      document.cookie = `remcochat_profile_id=${encodeURIComponent(
        activeProfileId
      )}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // ignore
    }
  }, [activeProfileId]);

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;
  }, [profiles, activeProfileId]);

  const activeProvider = useMemo(() => {
    if (!providersConfig) return null;
    return (
      providersConfig.providers.find(
        (p) => p.id === providersConfig.activeProviderId
      ) ??
      providersConfig.providers.find(
        (p) => p.id === providersConfig.defaultProviderId
      ) ??
      providersConfig.providers[0] ??
      null
    );
  }, [providersConfig]);

  const modelOptions = useMemo<ModelOption[]>(() => {
    return activeProvider?.models ?? [];
  }, [activeProvider]);

  const allowedModelIds = useMemo(() => {
    return new Set(modelOptions.map((m) => m.id));
  }, [modelOptions]);

  const isAllowedModel = useCallback(
    (modelId: unknown): modelId is string =>
      typeof modelId === "string" && allowedModelIds.has(modelId),
    [allowedModelIds]
  );

  const providerDefaultModelId =
    activeProvider?.defaultModelId ?? modelOptions[0]?.id ?? "";

  const fallbackProfileDefault = activeProfile?.defaultModelId ?? "";
  const profileDefaultModelId = isAllowedModel(fallbackProfileDefault)
    ? fallbackProfileDefault
    : providerDefaultModelId || fallbackProfileDefault;

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

    const canManageActiveChat =
      !isTemporaryChat &&
      Boolean(activeProfile) &&
      Boolean(activeChat) &&
      activeChat!.profileId === activeProfile!.id;

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

  const effectiveModelId = isTemporaryChat
    ? isAllowedModel(temporaryModelId)
      ? temporaryModelId
      : profileDefaultModelId
    : chatModelId;

  const selectedModel = useMemo(() => {
    return modelOptions.find((m) => m.id === effectiveModelId) ?? null;
  }, [effectiveModelId, modelOptions]);

  const reasoningOptions = useMemo(() => {
    if (!selectedModel?.capabilities?.reasoning) return [];
    return allowedReasoningEfforts({
      modelType: selectedModel.type,
      providerModelId: selectedModel.id,
      webToolsEnabled: Boolean(providersConfig?.webToolsEnabled),
    });
  }, [providersConfig?.webToolsEnabled, selectedModel]);

  const reasoningKey = useMemo(() => {
    if (!activeProfile) return "";
    return `remcochat:reasoningEffort:${activeProfile.id}:${effectiveModelId}`;
  }, [activeProfile, effectiveModelId]);

  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortChoice>(
    "auto"
  );

  useEffect(() => {
    if (!reasoningKey) return;
    if (!selectedModel?.capabilities?.reasoning) {
      setReasoningEffort("auto");
      return;
    }
    const stored = window.localStorage.getItem(reasoningKey) ?? "auto";
    setReasoningEffort(normalizeReasoningEffort(stored, reasoningOptions));
  }, [reasoningKey, reasoningOptions, selectedModel]);

  useEffect(() => {
    if (!reasoningKey) return;
    if (!selectedModel?.capabilities?.reasoning) return;
    window.localStorage.setItem(reasoningKey, reasoningEffort);
  }, [reasoningEffort, reasoningKey, selectedModel]);

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
    transport: chatTransport,
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

  const promptHistory = useMemo(() => {
    return extractPromptHistory(messages);
  }, [messages]);

  const [input, setInput] = useState("");
  const [composerAttachmentCount, setComposerAttachmentCount] = useState(0);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentUploadError, setAttachmentUploadError] = useState<string | null>(
    null
  );

  const canSend =
    status === "ready" &&
    !attachmentUploading &&
    (input.trim().length > 0 || composerAttachmentCount > 0);

  const [promptHistoryCursor, setPromptHistoryCursor] = useState<number>(
    Number.MAX_SAFE_INTEGER
  );
  const [promptHistoryDraft, setPromptHistoryDraft] = useState<string>("");

  const promptHistoryLengthRef = useRef<number>(promptHistory.length);

  useEffect(() => {
    const prevLen = promptHistoryLengthRef.current;
    const nextLen = promptHistory.length;
    promptHistoryLengthRef.current = nextLen;

    setPromptHistoryCursor((cursor) => {
      if (cursor === prevLen || cursor > nextLen) return nextLen;
      return cursor;
    });
  }, [promptHistory.length]);

  useEffect(() => {
    setPromptHistoryCursor(Number.MAX_SAFE_INTEGER);
    setPromptHistoryDraft("");
  }, [chatSessionKey]);

  useEffect(() => {
    setAttachmentUploadError(null);
    setAttachmentUploading(false);
  }, [chatSessionKey]);

  useEffect(() => {
    if (composerAttachmentCount === 0) {
      setAttachmentUploadError(null);
    }
  }, [composerAttachmentCount]);

  const handleComposerKeyDown: KeyboardEventHandler<HTMLTextAreaElement> =
    useCallback(
      (e) => {
        if (e.defaultPrevented) return;
        if (e.nativeEvent.isComposing) return;
        if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;

        const el = e.currentTarget;
        const selectionStart = el.selectionStart;
        const selectionEnd = el.selectionEnd;
        if (selectionStart == null || selectionEnd == null) return;
        if (selectionStart !== selectionEnd) return;

        if (e.key === "ArrowUp") {
          if (!isCaretOnFirstLine(el.value, selectionStart)) return;
          const res = navigatePromptHistory({
            direction: "up",
            history: promptHistory,
            cursor: promptHistoryCursor,
            draft: promptHistoryDraft,
            value: el.value,
          });
          if (!res.didNavigate) return;
          e.preventDefault();
          setPromptHistoryCursor(res.cursor);
          setPromptHistoryDraft(res.draft);
          setInput(res.value);
          requestFocusComposer({ toEnd: true });
          return;
        }

        if (e.key === "ArrowDown") {
          if (!isCaretOnLastLine(el.value, selectionStart)) return;
          const res = navigatePromptHistory({
            direction: "down",
            history: promptHistory,
            cursor: promptHistoryCursor,
            draft: promptHistoryDraft,
            value: el.value,
          });
          if (!res.didNavigate) return;
          e.preventDefault();
          setPromptHistoryCursor(res.cursor);
          setPromptHistoryDraft(res.draft);
          setInput(res.value);
          requestFocusComposer({ toEnd: true });
        }
      },
      [
        promptHistory,
        promptHistoryCursor,
        promptHistoryDraft,
      ]
    );

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

  const [renameChatOpen, setRenameChatOpen] = useState(false);
  const [renameChatId, setRenameChatId] = useState<string>("");
  const [renameChatDraft, setRenameChatDraft] = useState("");
  const [renameChatSaving, setRenameChatSaving] = useState(false);
  const [renameChatError, setRenameChatError] = useState<string | null>(null);

  const [folderError, setFolderError] = useState<string | null>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState("");
  const [newFolderSaving, setNewFolderSaving] = useState(false);
  const [newFolderError, setNewFolderError] = useState<string | null>(null);

  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [renameFolderId, setRenameFolderId] = useState<string>("");
  const [renameFolderDraft, setRenameFolderDraft] = useState("");
  const [renameFolderSaving, setRenameFolderSaving] = useState(false);
  const [renameFolderError, setRenameFolderError] = useState<string | null>(null);

	  const [deleteFolderOpen, setDeleteFolderOpen] = useState(false);
	  const [deleteFolderId, setDeleteFolderId] = useState<string>("");
	  const [deleteFolderName, setDeleteFolderName] = useState<string>("");
	  const [deleteFolderSaving, setDeleteFolderSaving] = useState(false);
	  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null);

    const [shareFolderOpen, setShareFolderOpen] = useState(false);
    const [shareFolderId, setShareFolderId] = useState<string>("");
    const [shareFolderName, setShareFolderName] = useState<string>("");
    const [shareFolderTarget, setShareFolderTarget] = useState<string>("");
    const [shareFolderSaving, setShareFolderSaving] = useState(false);
    const [shareFolderError, setShareFolderError] = useState<string | null>(null);

    type FolderMember = { profileId: string; name: string; createdAt: string };
    const [manageSharingOpen, setManageSharingOpen] = useState(false);
    const [manageSharingFolderId, setManageSharingFolderId] = useState<string>("");
    const [manageSharingFolderName, setManageSharingFolderName] = useState<string>("");
    const [manageSharingMembers, setManageSharingMembers] = useState<FolderMember[]>(
      []
    );
    const [manageSharingLoading, setManageSharingLoading] = useState(false);
    const [manageSharingSaving, setManageSharingSaving] = useState(false);
    const [manageSharingError, setManageSharingError] = useState<string | null>(null);

  const [memorizeOpen, setMemorizeOpen] = useState(false);
  const [memorizeText, setMemorizeText] = useState("");
  const [memorizeSaving, setMemorizeSaving] = useState(false);
  const [memorizeError, setMemorizeError] = useState<string | null>(null);

  const [deleteChatSaving, setDeleteChatSaving] = useState(false);
  const [deleteChatError, setDeleteChatError] = useState<string | null>(null);

  const [archivedOpen, setArchivedOpen] = useState(false);
  const [profileSelectOpen, setProfileSelectOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  useEffect(() => {
    if (renameChatOpen) return;
    setRenameChatId("");
    setRenameChatDraft("");
    setRenameChatError(null);
    setRenameChatSaving(false);
  }, [renameChatOpen]);

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

  const renameChatValidation = useMemo(() => {
    return validateChatTitle(renameChatDraft);
  }, [renameChatDraft]);

  const canSaveRenameChat =
    Boolean(activeProfile) &&
    status === "ready" &&
    Boolean(renameChatId) &&
    !renameChatSaving &&
    renameChatValidation.ok;

  const focusComposer = useCallback((opts?: { toEnd?: boolean }) => {
    requestFocusComposer(opts);
  }, []);

  const syncRef = useRef<{
    profileId: string;
    chatId: string;
    signature: string;
  } | null>(null);

  const loadedChatIdRef = useRef<string>("");

  const chatRequestBody = useMemo(() => {
    if (!activeProfile) return null;
    const reasoningPayload =
      selectedModel?.capabilities?.reasoning && reasoningOptions.length > 0
        ? { reasoning: { effort: reasoningEffort } }
        : {};
    if (isTemporaryChat) {
      return {
        profileId: activeProfile.id,
        modelId: effectiveModelId,
        temporary: true,
        temporarySessionId,
        ...reasoningPayload,
      };
    }
    if (!activeChat) return null;
    return {
      profileId: activeProfile.id,
      chatId: activeChat.id,
      modelId: effectiveModelId,
      ...reasoningPayload,
    };
  }, [
    activeChat,
    activeProfile,
    effectiveModelId,
    isTemporaryChat,
    reasoningEffort,
    reasoningOptions.length,
    selectedModel,
    temporarySessionId,
  ]);

  const refreshChatsNonceRef = useRef(0);
  const refreshChats = useCallback(async (input: {
    profileId: string;
    preferChatId?: string;
    ensureAtLeastOne?: boolean;
    seedFolderId?: string | null;
  }) => {
    const refreshNonce = (refreshChatsNonceRef.current += 1);
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
        let seededChat = created.chat;

        const seedFolderId = String(input.seedFolderId ?? "").trim();
        if (seedFolderId) {
          const moveRes = await fetch(`/api/chats/${created.chat.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profileId: input.profileId,
              folderId: seedFolderId,
            }),
          });
          const moved = (await moveRes.json().catch(() => null)) as
            | { chat?: Chat; error?: string }
            | null;
          if (moveRes.ok && moved?.chat) {
            seededChat = moved.chat;
          }
        }

        nextChats = [seededChat, ...nextChats];
      }
    }

    if (refreshNonce !== refreshChatsNonceRef.current) return;
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

  const refreshFoldersNonceRef = useRef(0);
	  const refreshFolders = useCallback(async (profileId: string) => {
	    const refreshNonce = (refreshFoldersNonceRef.current += 1);
	    const res = await fetch(`/api/folders?profileId=${profileId}`);
	    const data = (await res.json().catch(() => null)) as
	      | { folders?: ChatFolder[]; error?: string }
	      | null;
	    const nextFolders = Array.isArray(data?.folders) ? data!.folders! : [];
	    if (refreshNonce !== refreshFoldersNonceRef.current) return;
	    setFolders(nextFolders);
	  }, []);

    const ownedFolders = useMemo(() => {
      return folders.filter((f) => f.scope !== "shared");
    }, [folders]);

	    const sharedFoldersByOwner = useMemo(() => {
	      const map = new Map<string, ChatFolder[]>();
	      for (const folder of folders) {
	        if (folder.scope !== "shared") continue;
	        const owner = String(folder.ownerName ?? "").trim() || "Unknown";
	        const entry = map.get(owner);
	        if (entry) entry.push(folder);
	        else map.set(owner, [folder]);
	      }
	      return Array.from(map.entries()).sort(([a], [b]) =>
	        a.localeCompare(b, undefined, { sensitivity: "base" })
	      );
	    }, [folders]);

	  const folderGroupCollapsedStorageKey = useMemo(() => {
	    return activeProfile ? `remcochat:folderGroupCollapsed:${activeProfile.id}` : "";
	  }, [activeProfile?.id]);

	  const [folderGroupCollapsed, setFolderGroupCollapsed] = useState<
	    Record<string, boolean>
	  >({});

	  useEffect(() => {
	    if (!folderGroupCollapsedStorageKey) {
	      setFolderGroupCollapsed({});
	      return;
	    }
	    try {
	      const raw = window.localStorage.getItem(folderGroupCollapsedStorageKey);
	      if (!raw) {
	        setFolderGroupCollapsed({});
	        return;
	      }
	      const parsed = JSON.parse(raw) as unknown;
	      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
	        setFolderGroupCollapsed({});
	        return;
	      }
	      const next: Record<string, boolean> = {};
	      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
	        if (typeof v === "boolean") next[k] = v;
	      }
	      setFolderGroupCollapsed(next);
	    } catch {
	      setFolderGroupCollapsed({});
	    }
	  }, [folderGroupCollapsedStorageKey]);

	  const setFolderGroupCollapsedValue = useCallback(
	    (groupId: string, collapsed: boolean) => {
	      setFolderGroupCollapsed((prev) => {
	        if (prev[groupId] === collapsed) return prev;
	        const next = { ...prev, [groupId]: collapsed };
	        if (folderGroupCollapsedStorageKey) {
	          try {
	            window.localStorage.setItem(
	              folderGroupCollapsedStorageKey,
	              JSON.stringify(next)
	            );
	          } catch {
	            // ignore
	          }
	        }
	        return next;
	      });
	    },
	    [folderGroupCollapsedStorageKey]
	  );

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
      setFolders([]);
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

    setChats((prev) => {
      const without = prev.filter((c) => c.id !== data.chat!.id);
      const next = [data.chat!, ...without];
      next.sort(compareChatsForSidebar);
      return next;
    });
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

  const togglePinChatById = useCallback(
    async (chatId: string, nextPinned: boolean) => {
      if (!activeProfile) return;
      if (status !== "ready") return;

      const res = await fetch(`/api/chats/${chatId}/pin`, {
        method: nextPinned ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfile.id }),
      }).catch(() => null);
      if (!res) return;

      const data = (await res.json().catch(() => null)) as
        | { chat?: Chat; error?: string }
        | null;
      if (!res.ok || !data?.chat) return;

      const updated = data.chat;
      setChats((prev) => {
        const next = prev.map((c) => (c.id === updated.id ? updated : c));
        next.sort(compareChatsForSidebar);
        return next;
      });
    },
    [activeProfile, status]
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
    setFolders([]);
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

  const deleteChatById = useCallback(async (chatId: string, folderIdHint?: string | null) => {
    if (!activeProfile) return;
    if (deleteChatSaving) return;
    if (status !== "ready") return;

    const deletedFolderId =
      folderIdHint ?? chats.find((c) => c.id === chatId)?.folderId ?? null;

    setDeleteChatSaving(true);
    setDeleteChatError(null);
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
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

      refreshChats({
        profileId: activeProfile.id,
        ensureAtLeastOne: true,
        seedFolderId: deletedFolderId,
      }).catch(() => {});
    } catch (err) {
      setDeleteChatError(
        err instanceof Error ? err.message : "Failed to delete chat."
      );
    } finally {
      setDeleteChatSaving(false);
    }
  }, [activeProfile, chats, deleteChatSaving, refreshChats, status]);

  const openRenameChat = useCallback(
    (chatId: string) => {
      if (!activeProfile) return;
      if (status !== "ready") return;
      const target = chats.find((c) => c.id === chatId);
      if (!target) return;
      setRenameChatId(chatId);
      setRenameChatDraft(target.title);
      setRenameChatError(null);
      setRenameChatOpen(true);
    },
    [activeProfile, chats, status]
  );

  const renameChatTitle = useCallback(async () => {
    if (!activeProfile) return;
    if (status !== "ready") return;
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
        body: JSON.stringify({ profileId: activeProfile.id, title: nextTitle.title }),
      });

      const data = (await res.json().catch(() => null)) as
        | { chat?: Chat; error?: string }
        | null;
      if (!res.ok || !data?.chat) {
        throw new Error(data?.error || "Failed to rename chat.");
      }

      const updated = data.chat;
      setChats((prev) => {
        const next = prev.map((c) => (c.id === updated.id ? updated : c));
        next.sort(compareChatsForSidebar);
        return next;
      });

      setRenameChatOpen(false);
    } catch (err) {
      setRenameChatError(
        err instanceof Error ? err.message : "Failed to rename chat."
      );
    } finally {
      setRenameChatSaving(false);
    }
  }, [
    activeProfile,
    renameChatDraft,
    renameChatId,
    renameChatSaving,
    status,
  ]);

  const normalizeFolderNameDraft = useCallback((value: string) => {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }, []);

  const validateFolderNameDraft = useCallback(
    (value: string): { ok: true; name: string } | { ok: false; error: string } => {
      const name = normalizeFolderNameDraft(value);
      if (!name) return { ok: false, error: "Folder name is required." };
      if (name.length > 60) return { ok: false, error: "Folder name is too long." };
      return { ok: true, name };
    },
    [normalizeFolderNameDraft]
  );

	  const createFolderByName = useCallback(async () => {
	    if (!activeProfile) return;
	    if (status !== "ready") return;
	    if (newFolderSaving) return;

    const next = validateFolderNameDraft(newFolderDraft);
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
        body: JSON.stringify({ profileId: activeProfile.id, name: next.name }),
      });

      const data = (await res.json().catch(() => null)) as
        | { folder?: ChatFolder; error?: string }
        | null;
	      if (!res.ok || !data?.folder) {
	        throw new Error(data?.error || "Failed to create folder.");
	      }

	      refreshFolders(activeProfile.id).catch(() => {});
	      setNewFolderOpen(false);
	    } catch (err) {
	      setNewFolderError(
	        err instanceof Error ? err.message : "Failed to create folder."
      );
    } finally {
      setNewFolderSaving(false);
    }
	  }, [
	    activeProfile,
	    newFolderDraft,
	    newFolderSaving,
	    refreshFolders,
	    status,
	    validateFolderNameDraft,
	  ]);

  const openRenameFolder = useCallback(
    (folderId: string) => {
      if (!activeProfile) return;
      if (status !== "ready") return;
      const target = folders.find((f) => f.id === folderId);
      if (!target) return;
      setRenameFolderId(folderId);
      setRenameFolderDraft(target.name);
      setRenameFolderError(null);
      setRenameFolderOpen(true);
    },
    [activeProfile, folders, status]
  );

	  const saveRenameFolder = useCallback(async () => {
	    if (!activeProfile) return;
	    if (status !== "ready") return;
	    if (renameFolderSaving) return;
	    if (!renameFolderId) return;

    const next = validateFolderNameDraft(renameFolderDraft);
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
        body: JSON.stringify({ profileId: activeProfile.id, name: next.name }),
      });

      const data = (await res.json().catch(() => null)) as
        | { folder?: ChatFolder; error?: string }
        | null;
	      if (!res.ok || !data?.folder) {
	        throw new Error(data?.error || "Failed to rename folder.");
	      }

	      setFolders((prev) =>
	        prev.map((f) => (f.id === renameFolderId ? { ...f, name: next.name } : f))
	      );
	      refreshFolders(activeProfile.id).catch(() => {});
	      setRenameFolderOpen(false);
	    } catch (err) {
	      setRenameFolderError(
	        err instanceof Error ? err.message : "Failed to rename folder."
      );
    } finally {
      setRenameFolderSaving(false);
    }
	  }, [
	    activeProfile,
	    refreshFolders,
	    renameFolderDraft,
	    renameFolderId,
	    renameFolderSaving,
	    status,
	    validateFolderNameDraft,
	  ]);

	  const openDeleteFolder = useCallback(
	    (folderId: string) => {
	      if (!activeProfile) return;
	      if (status !== "ready") return;
	      const target = folders.find((f) => f.id === folderId);
	      if (!target) return;
	      setDeleteFolderId(folderId);
	      setDeleteFolderName(target.name);
	      setDeleteFolderError(null);
	      setDeleteFolderOpen(true);
	    },
	    [activeProfile, folders, status]
	  );

    const openShareFolder = useCallback(
      (folderId: string) => {
        if (!activeProfile) return;
        if (status !== "ready") return;
        const target = folders.find((f) => f.id === folderId);
        if (!target) return;
        if (target.scope === "shared") return;
        if (target.profileId !== activeProfile.id) return;
        setShareFolderId(folderId);
        setShareFolderName(target.name);
        setShareFolderTarget("");
        setShareFolderError(null);
        setShareFolderOpen(true);
      },
      [activeProfile, folders, status]
    );

    const confirmShareFolder = useCallback(async () => {
      if (!activeProfile) return;
      if (status !== "ready") return;
      if (!shareFolderId) return;
      if (shareFolderSaving) return;

      const target = String(shareFolderTarget ?? "").trim();
      if (!target) {
        setShareFolderError("Target profile is required.");
        return;
      }

      setShareFolderSaving(true);
      setShareFolderError(null);
      setFolderError(null);
      try {
        const res = await fetch(`/api/folders/${shareFolderId}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: activeProfile.id, targetProfile: target }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null;
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Failed to share folder.");
        }
        refreshFolders(activeProfile.id).catch(() => {});
        setShareFolderOpen(false);
      } catch (err) {
        setShareFolderError(
          err instanceof Error ? err.message : "Failed to share folder."
        );
      } finally {
        setShareFolderSaving(false);
      }
    }, [
      activeProfile,
      refreshFolders,
      shareFolderId,
      shareFolderSaving,
      shareFolderTarget,
      status,
    ]);

    const loadFolderMembers = useCallback(
      async (folderId: string) => {
        if (!activeProfile) return;
        setManageSharingLoading(true);
        setManageSharingError(null);
        try {
          const res = await fetch(
            `/api/folders/${folderId}/members?profileId=${activeProfile.id}`
          );
          const data = (await res.json().catch(() => null)) as
            | { members?: FolderMember[]; error?: string }
            | null;
          if (!res.ok) {
            throw new Error(data?.error || "Failed to load sharing settings.");
          }
          setManageSharingMembers(Array.isArray(data?.members) ? data!.members! : []);
        } catch (err) {
          setManageSharingError(
            err instanceof Error ? err.message : "Failed to load sharing settings."
          );
        } finally {
          setManageSharingLoading(false);
        }
      },
      [activeProfile]
    );

    const openManageFolderSharing = useCallback(
      (folderId: string) => {
        if (!activeProfile) return;
        if (status !== "ready") return;
        const target = folders.find((f) => f.id === folderId);
        if (!target) return;
        if (target.scope === "shared") return;
        if (target.profileId !== activeProfile.id) return;
        setManageSharingFolderId(folderId);
        setManageSharingFolderName(target.name);
        setManageSharingOpen(true);
        loadFolderMembers(folderId).catch(() => {});
      },
      [activeProfile, folders, loadFolderMembers, status]
    );

    const stopSharingFolderWithMember = useCallback(
      async (member: FolderMember) => {
        if (!activeProfile) return;
        if (status !== "ready") return;
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
              profileId: activeProfile.id,
              targetProfile: member.profileId,
            }),
          });
          const data = (await res.json().catch(() => null)) as
            | { ok?: boolean; error?: string }
            | null;
          if (!res.ok || !data?.ok) {
            throw new Error(data?.error || "Failed to stop sharing.");
          }
          setManageSharingMembers((prev) =>
            prev.filter((m) => m.profileId !== member.profileId)
          );
          refreshFolders(activeProfile.id).catch(() => {});
        } catch (err) {
          setManageSharingError(
            err instanceof Error ? err.message : "Failed to stop sharing."
          );
        } finally {
          setManageSharingSaving(false);
        }
      },
      [
        activeProfile,
        manageSharingFolderId,
        manageSharingSaving,
        refreshFolders,
        status,
      ]
    );

	  const confirmDeleteFolder = useCallback(async () => {
	    if (!activeProfile) return;
	    if (status !== "ready") return;
	    if (deleteFolderSaving) return;
	    if (!deleteFolderId) return;

    setDeleteFolderSaving(true);
    setDeleteFolderError(null);
    setFolderError(null);
    try {
      const res = await fetch(`/api/folders/${deleteFolderId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfile.id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to delete folder.");
      }

      setFolders((prev) => prev.filter((f) => f.id !== deleteFolderId));
      setChats((prev) =>
        prev.map((c) =>
          c.folderId === deleteFolderId ? { ...c, folderId: null } : c
        )
      );

      setDeleteFolderOpen(false);
    } catch (err) {
      setDeleteFolderError(
        err instanceof Error ? err.message : "Failed to delete folder."
      );
    } finally {
      setDeleteFolderSaving(false);
    }
  }, [activeProfile, deleteFolderId, deleteFolderSaving, status]);

  const toggleFolderCollapsed = useCallback(
    async (folderId: string, nextCollapsed: boolean) => {
      if (!activeProfile) return;
      if (status !== "ready") return;

      setFolderError(null);
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId ? { ...f, collapsed: nextCollapsed } : f
        )
      );

	      try {
	        const res = await fetch(`/api/folders/${folderId}`, {
	          method: "PATCH",
	          headers: { "Content-Type": "application/json" },
	          body: JSON.stringify({
	            profileId: activeProfile.id,
	            collapsed: nextCollapsed,
	          }),
	        });
	        const data = (await res.json().catch(() => null)) as
	          | { ok?: boolean; folder?: ChatFolder; error?: string }
	          | null;
	        if (!res.ok) {
	          throw new Error(data?.error || "Failed to update folder.");
	        }
	      } catch (err) {
	        setFolderError(err instanceof Error ? err.message : "Failed to update folder.");
	        refreshFolders(activeProfile.id).catch(() => {});
	      }
    },
    [activeProfile, refreshFolders, status]
  );

  const moveChatToFolder = useCallback(
    async (chatId: string, folderId: string | null) => {
      if (!activeProfile) return;
      if (status !== "ready") return;

      setFolderError(null);
      try {
        const res = await fetch(`/api/chats/${chatId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: activeProfile.id, folderId }),
        });
        const data = (await res.json().catch(() => null)) as
          | { chat?: Chat; error?: string }
          | null;
        if (!res.ok || !data?.chat) {
          throw new Error(data?.error || "Failed to move chat.");
        }

        setChats((prev) => prev.map((c) => (c.id === chatId ? data.chat! : c)));
      } catch (err) {
        setFolderError(err instanceof Error ? err.message : "Failed to move chat.");
      }
    },
    [activeProfile, status]
  );

  const setChatModel = async (nextModelId: string) => {
    if (!activeProfile) return;
    if (!activeChat) return;
    if (!isAllowedModel(nextModelId)) return;
    if (nextModelId === activeChat.modelId) return;

    const res = await fetch(`/api/chats/${activeChat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: activeProfile.id, modelId: nextModelId }),
    });

    const data = (await res.json()) as { chat?: Chat };
    if (!res.ok || !data.chat) return;

    setChats((prev) => {
      const next = prev.map((c) => (c.id === data.chat!.id ? data.chat! : c));
      next.sort(compareChatsForSidebar);
      return next;
    });
  };

  useEffect(() => {
    if (!activeProfile) return;
    refreshChats({ profileId: activeProfile.id, ensureAtLeastOne: true }).catch(
      () => {}
    );
    refreshFolders(activeProfile.id).catch(() => {});
  }, [activeProfile, refreshChats, refreshFolders]);

  useEffect(() => {
    loadedChatIdRef.current = "";
  }, [activeChatId, isTemporaryChat]);

  useEffect(() => {
    loadedChatIdRef.current = "";
    syncRef.current = null;
  }, [activeProfileId]);

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
      queueScrollTranscriptToBottom("instant");
    })().catch(() => {});

    return () => {
      aborted = true;
    };
  }, [
    activeChatId,
    activeProfile,
    isTemporaryChat,
    queueScrollTranscriptToBottom,
    setMessages,
    stop,
  ]);

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
    if (adminOpen) return;
    if (profileSelectOpen) return;
    focusComposer({ toEnd: true });
  }, [
    activeChatId,
    adminOpen,
    chatSettingsOpen,
    createOpen,
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

    useEffect(() => {
      if (!activeProfile) return;
      if (isTemporaryChat) return;
      if (!error) return;

      const msg = String((error as { message?: unknown } | null)?.message ?? error)
        .trim()
        .toLowerCase();
      if (!msg.includes("not accessible")) return;

      stop();
      setFolderError("This chat is no longer shared with this profile.");
      refreshFolders(activeProfile.id).catch(() => {});
      refreshChats({ profileId: activeProfile.id, ensureAtLeastOne: true }).catch(
        () => {}
      );
    }, [activeProfile, error, isTemporaryChat, refreshChats, refreshFolders, stop]);

  const regenerateLatest = useCallback(() => {
    if (status !== "ready") return;
    if (!chatRequestBody) return;
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "user") {
      // After a fork, the latest user message often has no assistant response yet.
      // `regenerate()` without a messageId will generate the assistant response for the last message.
      scrollTranscriptToBottom("smooth");
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

    scrollTranscriptToBottom("smooth");
    regenerate({
      messageId: assistant.id,
      body: {
        ...chatRequestBody,
        regenerate: true,
        regenerateMessageId: assistant.id,
      },
    }).catch(() => {});
  }, [
    chatRequestBody,
    messages,
    regenerate,
    scrollTranscriptToBottom,
    setVariantsByUserMessageId,
    status,
  ]);

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
        const next = [data.chat!, ...without];
        next.sort(compareChatsForSidebar);
        return next;
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
	    if (!canManageActiveChat) return;
	    const chatId = activeChat?.id ?? "";
	    if (!chatId) return;
	    setChatSettingsChatId(chatId);
	    setChatSettingsOpen(true);
	  }, [activeChat?.id, canManageActiveChat, isTemporaryChat, status]);

  useEffect(() => {
    if (!chatSettingsOpen) return;
    setChatSettingsError(null);
    const target =
      chats.find((c) => c.id === chatSettingsChatId) ?? activeChat;
    setChatInstructionsDraft(target?.chatInstructions ?? "");
  }, [activeChat, chatSettingsChatId, chatSettingsOpen, chats]);

  const saveChatSettings = useCallback(async () => {
    if (!activeProfile) return;
    const targetChatId = chatSettingsChatId || activeChat?.id || "";
    if (!targetChatId) return;
    if (chatSettingsSaving) return;

    setChatSettingsSaving(true);
    setChatSettingsError(null);
    try {
      const res = await fetch(`/api/chats/${targetChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfile.id,
          chatInstructions: chatInstructionsDraft,
        }),
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

  const sendMemoryDecision = useCallback(
    (decision: "confirm" | "cancel") => {
      if (!activeProfile) return;
      if (!chatRequestBody) return;
      if (status !== "ready") return;

      sendMessage(
        {
          text: decision === "confirm" ? "Confirm memory" : "Cancel memory",
          metadata: { createdAt: new Date().toISOString() },
        },
        { body: chatRequestBody }
      );
    },
    [activeProfile, chatRequestBody, sendMessage, status]
  );

  const sendOpenList = useCallback(
    (list: TaskListOverview) => {
      if (!chatRequestBody) return;
      if (status !== "ready") return;
      const ownerSuffix =
        list.scope === "shared" && list.ownerProfileName
          ? ` from ${list.ownerProfileName}`
          : "";
      sendMessage(
        {
          text: `Open list "${list.name}"${ownerSuffix}.`,
          metadata: { createdAt: new Date().toISOString() },
        },
        { body: chatRequestBody }
      );
    },
    [chatRequestBody, sendMessage, status]
  );

  const closeSidebarDrawer = useCallback(() => {
    setSidebarOpen(false);
    window.setTimeout(() => focusComposer({ toEnd: true }), 0);
  }, [focusComposer]);

	  const renderSidebar = (mode: "desktop" | "drawer") => {
	    const closeIfDrawer = () => {
	      if (mode !== "drawer") return;
	      closeSidebarDrawer();
	    };

	    const rootChats = chats
	      .filter((c) => !c.archivedAt && c.folderId == null)
	      .sort(compareChatsForSidebar);
	    const showFoldersSeparator =
	      rootChats.length > 0 &&
	      (ownedFolders.length > 0 || sharedFoldersByOwner.length > 0);

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="font-semibold tracking-tight">RemcoChat</div>
          {mode === "drawer" ? (
            <DialogClose asChild>
              <Button
                aria-label="Close menu"
                className="h-8 w-8"
                size="icon"
                type="button"
                variant="ghost"
              >
                <XIcon className="size-4" />
              </Button>
            </DialogClose>
          ) : (
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <div className="text-sm font-medium text-muted-foreground">Chats</div>
            <div className="flex items-center gap-1">
              <Button
                aria-label="New folder"
                className="h-7 w-7 px-0"
                data-testid="sidebar:new-folder"
                disabled={!activeProfile || status !== "ready"}
                onClick={() => setNewFolderOpen(true)}
                title="New folder"
                type="button"
                variant="secondary"
              >
                <FolderPlusIcon className="size-4" />
              </Button>
              <Button
                aria-label="New chat"
                className="h-7 w-7 px-0"
                data-testid="sidebar:new-chat"
                disabled={!activeProfile || status !== "ready"}
                onClick={() => {
                  createChat();
                  closeIfDrawer();
                }}
                title="New chat"
                type="button"
                variant="secondary"
              >
                <PlusIcon className="size-4" />
              </Button>
            </div>
          </div>
          {deleteChatError ? (
            <div className="px-2 pb-2 text-sm text-destructive">
              {deleteChatError}
            </div>
          ) : null}
          {folderError ? (
            <div className="px-2 pb-2 text-sm text-destructive">{folderError}</div>
          ) : null}

		          <div className="space-y-1 px-1 pb-2" data-testid="sidebar:chats-active">
		            <div className="space-y-1" data-testid="sidebar:folders">
		              {sharedFoldersByOwner.length > 0 ? (
		                <button
		                  aria-expanded={!folderGroupCollapsed["folders:personal"]}
		                  className="flex w-full items-center gap-2 px-3 text-left text-sm font-medium text-muted-foreground"
		                  data-testid="sidebar:folders-personal-toggle"
		                  onClick={() =>
		                    setFolderGroupCollapsedValue(
		                      "folders:personal",
		                      !folderGroupCollapsed["folders:personal"]
		                    )
			                  }
			                  type="button"
			                >
			                  {folderGroupCollapsed["folders:personal"] ? (
			                    <FolderIcon className="size-4 shrink-0" />
			                  ) : (
			                    <FolderOpenIcon className="size-4 shrink-0" />
			                  )}
			                  <span>Personal folders</span>
			                </button>
			              ) : null}
			              {sharedFoldersByOwner.length > 0 &&
			              folderGroupCollapsed["folders:personal"] ? null : (
			                <div className={sharedFoldersByOwner.length > 0 ? "pl-6" : ""}>
			                  {ownedFolders.map((folder) => {
			                const folderChats = chats
			                  .filter(
			                    (c) => !c.archivedAt && c.folderId === folder.id
			                  )
			                  .sort(compareChatsForSidebar);
			                return (
                  <div className="space-y-1" key={folder.id}>
                    <div
                      className={
                        "group flex items-center gap-1 rounded-md transition-colors hover:bg-sidebar-accent/70"
                      }
                      data-testid={`sidebar:folder:${folder.id}`}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                        data-testid={`sidebar:folder-toggle:${folder.id}`}
                        onClick={() =>
                          toggleFolderCollapsed(folder.id, !folder.collapsed)
                        }
                        type="button"
                      >
		                        <div className="relative size-4 shrink-0 text-muted-foreground">
		                          {folder.collapsed ? (
		                            <FolderIcon className="size-4" />
		                          ) : (
		                            <FolderOpenIcon className="size-4" />
		                          )}
		                          {(folder.sharedWithCount ?? 0) > 0 ? (
		                            <UsersIcon className="absolute -bottom-1 -right-1 size-3" />
		                          ) : null}
		                        </div>
	                        <div className="truncate">{folder.name}</div>
		                        <div className="ml-auto text-sm text-muted-foreground">
	                          {folderChats.length}
	                        </div>
	                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
	                          <Button
	                            className="h-8 w-8 shrink-0 px-0 opacity-60 transition-opacity group-hover:opacity-100"
	                            data-testid={`sidebar:folder-menu:${folder.id}`}
	                            disabled={
	                              !activeProfile ||
	                              status !== "ready" ||
	                              folder.profileId !== activeProfile.id
	                            }
	                            suppressHydrationWarning
	                            type="button"
	                            variant="ghost"
	                          >
	                            <MoreVerticalIcon className="size-4" />
	                          </Button>
	                        </DropdownMenuTrigger>
	                        <DropdownMenuContent align="end">
	                          <DropdownMenuItem
	                            data-testid={`folder-action:share:${folder.id}`}
	                            onClick={() => openShareFolder(folder.id)}
	                          >
	                            <UsersIcon />
	                            Share folder…
	                          </DropdownMenuItem>
	                          {(folder.sharedWithCount ?? 0) > 0 ? (
	                            <DropdownMenuItem
	                              data-testid={`folder-action:manage-sharing:${folder.id}`}
	                              onClick={() => openManageFolderSharing(folder.id)}
	                            >
	                              <UsersIcon />
	                              Manage sharing…
	                            </DropdownMenuItem>
	                          ) : null}
	                          <DropdownMenuSeparator />
	                          <DropdownMenuItem
	                            data-testid={`folder-action:rename:${folder.id}`}
	                            onClick={() => openRenameFolder(folder.id)}
	                          >
	                            <PencilIcon />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            data-testid={`folder-action:delete:${folder.id}`}
                            onClick={() => openDeleteFolder(folder.id)}
                            variant="destructive"
                          >
                            <Trash2Icon />
                            Delete folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {!folder.collapsed ? (
	                      <div className="space-y-1 pl-6">
                        {folderChats.map((chat) => (
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
	                                if (!activeProfile) return;
	                                setIsTemporaryChat(false);
	                                setActiveChatId(chat.id);
	                                closeIfDrawer();
	                              }}
	                              type="button"
                            >
	                              <div className="truncate">
	                                {chat.title.trim() ? chat.title : "New chat"}
	                              </div>
	                            </button>

	                            <Button
	                              aria-label={
	                                chatIsPinned(chat) ? "Unpin chat" : "Pin chat"
	                              }
	                              aria-pressed={chatIsPinned(chat)}
	                              className={
	                                "h-8 w-8 shrink-0 px-0 transition-opacity " +
	                                (chatIsPinned(chat)
	                                  ? "opacity-100"
	                                  : "opacity-50 group-hover:opacity-100")
	                              }
	                              data-testid={`sidebar:chat-pin:${chat.id}`}
	                              disabled={!activeProfile || status !== "ready"}
	                              onClick={(e) => {
	                                e.preventDefault();
	                                e.stopPropagation();
	                                togglePinChatById(chat.id, !chatIsPinned(chat));
	                              }}
	                              suppressHydrationWarning
	                              type="button"
	                              variant="ghost"
	                            >
	                              {chatIsPinned(chat) ? (
	                                <PinIcon className="size-4 text-sidebar-primary" />
	                              ) : (
	                                <PinOffIcon className="size-4 text-muted-foreground" />
	                              )}
	                            </Button>

	                            <DropdownMenu>
	                              <DropdownMenuTrigger asChild>
	                                <Button
                                  className="h-8 w-8 shrink-0 px-0 opacity-60 transition-opacity group-hover:opacity-100"
                                  data-testid={`sidebar:chat-menu:${chat.id}`}
                                  disabled={
                                    !activeProfile ||
                                    status !== "ready" ||
                                    chat.profileId !== activeProfile.id
                                  }
                                  suppressHydrationWarning
                                  type="button"
                                  variant="ghost"
                                >
                                  <MoreVerticalIcon className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger
                                    data-testid={`chat-action:move-folder:${chat.id}`}
                                  >
                                    <FolderIcon />
                                    Move to folder…
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuRadioGroup
                                      onValueChange={(value) => {
                                        moveChatToFolder(chat.id, value || null);
                                      }}
                                      value={chat.folderId ?? ""}
                                    >
	                                      <DropdownMenuRadioItem value="">
	                                        No folder
	                                      </DropdownMenuRadioItem>
	                                      {ownedFolders.map((f) => (
	                                        <DropdownMenuRadioItem key={f.id} value={f.id}>
	                                          {f.name}
	                                        </DropdownMenuRadioItem>
	                                      ))}
	                                    </DropdownMenuRadioGroup>
	                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>

                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  data-testid={`chat-action:archive:${chat.id}`}
                                  onClick={() => {
                                    if (!activeProfile) return;
                                    if (chat.profileId !== activeProfile.id) return;
                                    archiveChatById(chat.id);
                                    closeIfDrawer();
                                  }}
                                >
                                  <ArchiveIcon />
                                  Archive
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  data-testid={`chat-action:rename:${chat.id}`}
                                  onClick={() => {
                                    if (!activeProfile) return;
                                    if (chat.profileId !== activeProfile.id) return;
                                    openRenameChat(chat.id);
                                  }}
                                >
                                  <PencilIcon />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  data-testid={`chat-action:export-md:${chat.id}`}
                                  onClick={() => {
                                    if (!activeProfile) return;
                                    if (chat.profileId !== activeProfile.id) return;
                                    exportChatById(chat.id, "md");
                                  }}
                                >
                                  <DownloadIcon />
                                  Export Markdown
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  data-testid={`chat-action:export-json:${chat.id}`}
                                  onClick={() => {
                                    if (!activeProfile) return;
                                    if (chat.profileId !== activeProfile.id) return;
                                    exportChatById(chat.id, "json");
                                  }}
                                >
                                  <DownloadIcon />
                                  Export JSON
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  data-testid={`chat-action:delete:${chat.id}`}
                                  onClick={() => {
                                    if (!activeProfile) return;
                                    if (chat.profileId !== activeProfile.id) return;
                                    deleteChatById(chat.id, chat.folderId);
                                    closeIfDrawer();
                                  }}
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
                    ) : null}
			                  </div>
			                );
			              })}
			                </div>
			              )}
			            </div>

		              {sharedFoldersByOwner.length > 0 ? (
		                <div className="space-y-2 pt-2" data-testid="sidebar:folders-shared">
	                  <button
	                    aria-expanded={!folderGroupCollapsed["folders:shared"]}
	                    className="flex w-full items-center gap-2 px-3 text-left text-sm font-medium text-muted-foreground"
	                    data-testid="sidebar:folders-shared-toggle"
	                    onClick={() =>
	                      setFolderGroupCollapsedValue(
	                        "folders:shared",
	                        !folderGroupCollapsed["folders:shared"]
	                      )
		                    }
		                    type="button"
		                  >
		                    {folderGroupCollapsed["folders:shared"] ? (
		                      <FolderIcon className="size-4 shrink-0" />
		                    ) : (
		                      <FolderOpenIcon className="size-4 shrink-0" />
		                    )}
		                    <span>Shared with me</span>
		                  </button>

	                  {folderGroupCollapsed["folders:shared"]
	                    ? null
	                    : sharedFoldersByOwner.map(([ownerName, ownerFolders]) => {
	                        const ownerGroupId = `folders:shared-from:${ownerName}`;
	                        const ownerGroupCollapsed = Boolean(
	                          folderGroupCollapsed[ownerGroupId]
	                        );
	                        return (
	                          <div className="space-y-1 pl-6" key={ownerName}>
	                            <button
	                              aria-expanded={!ownerGroupCollapsed}
		                              className="flex w-full items-center gap-2 px-3 pt-1 text-left text-sm font-medium text-muted-foreground"
	                              onClick={() =>
	                                setFolderGroupCollapsedValue(
	                                  ownerGroupId,
	                                  !ownerGroupCollapsed
	                                )
		                              }
		                              type="button"
		                            >
		                              {ownerGroupCollapsed ? (
		                                <FolderIcon className="size-4 shrink-0" />
		                              ) : (
		                                <FolderOpenIcon className="size-4 shrink-0" />
		                              )}
		                              <span>by {ownerName}</span>
		                            </button>

	                            {ownerGroupCollapsed
	                              ? null
	                              : ownerFolders.map((folder) => {
		                        const folderChats = chats
		                          .filter(
		                            (c) => !c.archivedAt && c.folderId === folder.id
		                          )
		                          .sort(compareChatsForSidebar);
	                        return (
                          <div className="space-y-1" key={folder.id}>
                            <div
                              className={
                                "group flex items-center gap-1 rounded-md transition-colors hover:bg-sidebar-accent/70"
                              }
                              data-testid={`sidebar:shared-folder:${folder.id}`}
                            >
                              <button
                                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                                data-testid={`sidebar:folder-toggle:${folder.id}`}
                                onClick={() =>
                                  toggleFolderCollapsed(folder.id, !folder.collapsed)
                                }
                                type="button"
                              >
	                                <div className="relative size-4 shrink-0 text-muted-foreground">
	                                  {folder.collapsed ? (
	                                    <FolderIcon className="size-4" />
	                                  ) : (
	                                    <FolderOpenIcon className="size-4" />
	                                  )}
	                                  <UsersIcon className="absolute -bottom-1 -right-1 size-3" />
	                                </div>
                                <div className="truncate">{folder.name}</div>
	                                <div className="ml-auto text-sm text-muted-foreground">
                                  {folderChats.length}
                                </div>
                              </button>
                            </div>

	                            {!folder.collapsed ? (
		                              <div className="space-y-1 pl-6">
	                                {folderChats.map((chat) => (
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
                                        if (!activeProfile) return;
                                        setIsTemporaryChat(false);
                                        setActiveChatId(chat.id);
                                        closeIfDrawer();
                                      }}
                                      type="button"
                                    >
	                                      <div className="truncate">
	                                        {chat.title.trim() ? chat.title : "New chat"}
	                                      </div>
	                                    </button>

	                                    <Button
	                                      aria-label={
	                                        chatIsPinned(chat) ? "Unpin chat" : "Pin chat"
	                                      }
	                                      aria-pressed={chatIsPinned(chat)}
	                                      className={
	                                        "h-8 w-8 shrink-0 px-0 transition-opacity " +
	                                        (chatIsPinned(chat)
	                                          ? "opacity-100"
	                                          : "opacity-50 group-hover:opacity-100")
	                                      }
	                                      data-testid={`sidebar:chat-pin:${chat.id}`}
	                                      disabled={!activeProfile || status !== "ready"}
	                                      onClick={(e) => {
	                                        e.preventDefault();
	                                        e.stopPropagation();
	                                        togglePinChatById(chat.id, !chatIsPinned(chat));
	                                      }}
	                                      suppressHydrationWarning
	                                      type="button"
	                                      variant="ghost"
	                                    >
	                                      {chatIsPinned(chat) ? (
	                                        <PinIcon className="size-4 text-sidebar-primary" />
	                                      ) : (
	                                        <PinOffIcon className="size-4 text-muted-foreground" />
	                                      )}
	                                    </Button>

	                                    <DropdownMenu>
	                                      <DropdownMenuTrigger asChild>
	                                        <Button
                                          className="h-8 w-8 shrink-0 px-0 opacity-60 transition-opacity group-hover:opacity-100"
                                          data-testid={`sidebar:chat-menu:${chat.id}`}
                                          disabled={
                                            !activeProfile ||
                                            status !== "ready" ||
                                            chat.profileId !== activeProfile.id
                                          }
                                          suppressHydrationWarning
                                          type="button"
                                          variant="ghost"
                                        >
                                          <MoreVerticalIcon className="size-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger
                                            data-testid={`chat-action:move-folder:${chat.id}`}
                                          >
                                            <FolderIcon />
                                            Move to folder…
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            <DropdownMenuRadioGroup
                                              onValueChange={(value) => {
                                                moveChatToFolder(chat.id, value || null);
                                              }}
                                              value={chat.folderId ?? ""}
                                            >
                                              <DropdownMenuRadioItem value="">
                                                No folder
                                              </DropdownMenuRadioItem>
                                              {ownedFolders.map((f) => (
                                                <DropdownMenuRadioItem
                                                  key={f.id}
                                                  value={f.id}
                                                >
                                                  {f.name}
                                                </DropdownMenuRadioItem>
                                              ))}
                                            </DropdownMenuRadioGroup>
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>

                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          data-testid={`chat-action:archive:${chat.id}`}
                                          onClick={() => {
                                            if (!activeProfile) return;
                                            if (chat.profileId !== activeProfile.id) return;
                                            archiveChatById(chat.id);
                                            closeIfDrawer();
                                          }}
                                        >
                                          <ArchiveIcon />
                                          Archive
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          data-testid={`chat-action:rename:${chat.id}`}
                                          onClick={() => {
                                            if (!activeProfile) return;
                                            if (chat.profileId !== activeProfile.id) return;
                                            openRenameChat(chat.id);
                                          }}
                                        >
                                          <PencilIcon />
                                          Rename
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          data-testid={`chat-action:export-md:${chat.id}`}
                                          onClick={() => {
                                            if (!activeProfile) return;
                                            if (chat.profileId !== activeProfile.id) return;
                                            exportChatById(chat.id, "md");
                                          }}
                                        >
                                          <DownloadIcon />
                                          Export Markdown
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          data-testid={`chat-action:export-json:${chat.id}`}
                                          onClick={() => {
                                            if (!activeProfile) return;
                                            if (chat.profileId !== activeProfile.id) return;
                                            exportChatById(chat.id, "json");
                                          }}
                                        >
                                          <DownloadIcon />
                                          Export JSON
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          data-testid={`chat-action:delete:${chat.id}`}
                                          onClick={() => {
                                            if (!activeProfile) return;
                                            if (chat.profileId !== activeProfile.id) return;
                                            deleteChatById(chat.id, chat.folderId);
                                            closeIfDrawer();
                                          }}
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
	                            ) : null}
	                          </div>
	                        );
	                      })}
	                          </div>
	                        );
	                      })}
	                </div>
	              ) : null}

		            {showFoldersSeparator ? (
		              <div
		                aria-hidden="true"
		                data-testid="sidebar:folders-separator"
		                className="py-2"
		              >
		                <div className="h-[2px] w-full rounded-full bg-black/20 dark:bg-white/20" />
		              </div>
		            ) : null}

		            {rootChats.map((chat) => (
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
	                      if (!activeProfile) return;
	                      setIsTemporaryChat(false);
	                      setActiveChatId(chat.id);
	                      closeIfDrawer();
	                    }}
	                    type="button"
                  >
	                    <div className="truncate">
	                      {chat.title.trim() ? chat.title : "New chat"}
	                    </div>
	                  </button>

	                  <Button
	                    aria-label={chatIsPinned(chat) ? "Unpin chat" : "Pin chat"}
	                    aria-pressed={chatIsPinned(chat)}
	                    className={
	                      "h-8 w-8 shrink-0 px-0 transition-opacity " +
	                      (chatIsPinned(chat)
	                        ? "opacity-100"
	                        : "opacity-50 group-hover:opacity-100")
	                    }
	                    data-testid={`sidebar:chat-pin:${chat.id}`}
	                    disabled={!activeProfile || status !== "ready"}
	                    onClick={(e) => {
	                      e.preventDefault();
	                      e.stopPropagation();
	                      togglePinChatById(chat.id, !chatIsPinned(chat));
	                    }}
	                    suppressHydrationWarning
	                    type="button"
	                    variant="ghost"
	                  >
	                    {chatIsPinned(chat) ? (
	                      <PinIcon className="size-4 text-sidebar-primary" />
	                    ) : (
	                      <PinOffIcon className="size-4 text-muted-foreground" />
	                    )}
	                  </Button>

	                  <DropdownMenu>
	                    <DropdownMenuTrigger asChild>
	                      <Button
                        className="h-8 w-8 shrink-0 px-0 opacity-60 transition-opacity group-hover:opacity-100"
                        data-testid={`sidebar:chat-menu:${chat.id}`}
                        disabled={
                          !activeProfile ||
                          status !== "ready" ||
                          chat.profileId !== activeProfile.id
                        }
                        suppressHydrationWarning
                        type="button"
                        variant="ghost"
                      >
                        <MoreVerticalIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger
                          data-testid={`chat-action:move-folder:${chat.id}`}
                        >
                          <FolderIcon />
                          Move to folder…
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuRadioGroup
                            onValueChange={(value) => {
                              moveChatToFolder(chat.id, value || null);
                            }}
                            value={chat.folderId ?? ""}
                          >
	                            <DropdownMenuRadioItem value="">
	                              No folder
	                            </DropdownMenuRadioItem>
	                            {ownedFolders.map((f) => (
	                              <DropdownMenuRadioItem key={f.id} value={f.id}>
	                                {f.name}
	                              </DropdownMenuRadioItem>
		              ))}
	                          </DropdownMenuRadioGroup>
	                        </DropdownMenuSubContent>
                      </DropdownMenuSub>

                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        data-testid={`chat-action:archive:${chat.id}`}
                        onClick={() => {
                          if (!activeProfile) return;
                          if (chat.profileId !== activeProfile.id) return;
                          archiveChatById(chat.id);
                          closeIfDrawer();
                        }}
                      >
                        <ArchiveIcon />
                        Archive
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid={`chat-action:rename:${chat.id}`}
                        onClick={() => {
                          if (!activeProfile) return;
                          if (chat.profileId !== activeProfile.id) return;
                          openRenameChat(chat.id);
                        }}
                      >
                        <PencilIcon />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        data-testid={`chat-action:export-md:${chat.id}`}
                        onClick={() => {
                          if (!activeProfile) return;
                          if (chat.profileId !== activeProfile.id) return;
                          exportChatById(chat.id, "md");
                        }}
                      >
                        <DownloadIcon />
                        Export Markdown
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid={`chat-action:export-json:${chat.id}`}
                        onClick={() => {
                          if (!activeProfile) return;
                          if (chat.profileId !== activeProfile.id) return;
                          exportChatById(chat.id, "json");
                        }}
                      >
                        <DownloadIcon />
                        Export JSON
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        data-testid={`chat-action:delete:${chat.id}`}
                                  onClick={() => {
                                    if (!activeProfile) return;
                                    if (chat.profileId !== activeProfile.id) return;
                                    deleteChatById(chat.id, chat.folderId);
                                    closeIfDrawer();
                                  }}
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
	                    className="flex w-full items-center justify-between gap-2 px-3 pb-1 text-left text-sm font-medium text-muted-foreground"
                    data-testid="sidebar:archived-toggle"
                    suppressHydrationWarning
                    type="button"
                  >
                    <span>
                      Archived (
                      {chats.filter((c) => Boolean(c.archivedAt)).length})
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
	                              if (!activeProfile) return;
	                              setIsTemporaryChat(false);
	                              setActiveChatId(chat.id);
	                              closeIfDrawer();
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
                                disabled={
                                  !activeProfile ||
                                  status !== "ready" ||
                                  chat.profileId !== activeProfile.id
                                }
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
                                onClick={() => {
                                  if (!activeProfile) return;
                                  if (chat.profileId !== activeProfile.id) return;
                                  unarchiveChatById(chat.id);
                                  closeIfDrawer();
                                }}
                              >
                                <Undo2Icon />
                                Unarchive
                              </DropdownMenuItem>

                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger
                                  data-testid={`chat-action:move-folder:${chat.id}`}
                                >
                                  <FolderIcon />
                                  Move to folder…
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuRadioGroup
                                    onValueChange={(value) => {
                                      moveChatToFolder(chat.id, value || null);
                                    }}
                                    value={chat.folderId ?? ""}
                                  >
                                    <DropdownMenuRadioItem value="">
                                      No folder
                                    </DropdownMenuRadioItem>
	                                    {ownedFolders.map((f) => (
	                                      <DropdownMenuRadioItem key={f.id} value={f.id}>
	                                        {f.name}
	                                      </DropdownMenuRadioItem>
	                                    ))}
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>

                              <DropdownMenuItem
                                data-testid={`chat-action:rename:${chat.id}`}
                                onClick={() => {
                                  if (!activeProfile) return;
                                  if (chat.profileId !== activeProfile.id) return;
                                  openRenameChat(chat.id);
                                }}
                              >
                                <PencilIcon />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                data-testid={`chat-action:export-md:${chat.id}`}
                                onClick={() => {
                                  if (!activeProfile) return;
                                  if (chat.profileId !== activeProfile.id) return;
                                  exportChatById(chat.id, "md");
                                }}
                              >
                                <DownloadIcon />
                                Export Markdown
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`chat-action:export-json:${chat.id}`}
                                onClick={() => {
                                  if (!activeProfile) return;
                                  if (chat.profileId !== activeProfile.id) return;
                                  exportChatById(chat.id, "json");
                                }}
                              >
                                <DownloadIcon />
                                Export JSON
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                data-testid={`chat-action:delete:${chat.id}`}
                                  onClick={() => {
                                    if (!activeProfile) return;
                                    if (chat.profileId !== activeProfile.id) return;
                                    deleteChatById(chat.id, chat.folderId);
                                    closeIfDrawer();
                                  }}
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
          <div className="mb-2 text-sm font-medium text-muted-foreground">
            Profile
          </div>
          <div className="flex items-center gap-2">
            <Select
              onOpenChange={(open) => {
                setProfileSelectOpen(open);
                if (open) return;
                window.setTimeout(() => focusComposer({ toEnd: true }), 0);
              }}
              onValueChange={(value) => {
                setActiveProfileId(value);
                setChats([]);
                setActiveChatId("");
                setVariantsByUserMessageId({});
                setIsTemporaryChat(false);
                closeIfDrawer();
              }}
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
              onClick={() => {
                setCreateOpen(true);
                closeIfDrawer();
              }}
              title="New profile"
              type="button"
              variant="secondary"
            >
              <PlusIcon className="size-4" />
            </Button>

            <Button
              aria-label="Profile settings"
              className="h-9 w-9 px-0"
              data-testid="profile:settings-open"
              disabled={status !== "ready"}
              onClick={() => {
                setSettingsOpen(true);
                closeIfDrawer();
              }}
              title="Profile settings"
              type="button"
              variant="secondary"
            >
              <SettingsIcon className="size-4" />
            </Button>
          </div>

          {appVersion ? (
            <div
              className="mt-3 text-[11px] text-muted-foreground"
              data-testid="app:version"
            >
              v{appVersion} · (c) kaaLabs &apos;26
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
	    <div className="h-dvh w-full overflow-hidden bg-background text-foreground">
	      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[18rem_1fr]">
	        <aside className="hidden min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
	          {renderSidebar("desktop")}
	        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
	          <header className="border-b">
	            <div className="flex flex-wrap items-center gap-3 pb-3 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
	              <div className="flex min-w-0 items-center gap-2 md:hidden">
	                <Button
	                  aria-label="Open menu"
	                  onClick={() => setSidebarOpen(true)}
	                  size="icon"
	                  type="button"
	                  variant="ghost"
	                >
	                  <MenuIcon className="size-4" />
	                </Button>
	                <div className="truncate font-semibold tracking-tight">RemcoChat</div>
	              </div>

	              <div className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:w-auto">
	                <div className="hidden shrink-0 text-sm text-muted-foreground md:block">
	                  Model
	                </div>
		                <ModelPicker
                      disabled={!isTemporaryChat && !canManageActiveChat}
		                  className="min-w-0 w-full md:w-auto"
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
	                  options={modelOptions}
	                  triggerTestId="model:picker-trigger"
	                  value={effectiveModelId}
	                />
	              </div>

	              <div className="ml-auto flex items-center gap-2">
	                <div className="md:hidden">
	                  <ThemeToggle />
	                </div>
                  {bashToolsLanAccessEnabled ? (
                    <Button
                      className="h-9 w-9 justify-start gap-2 px-0 md:w-auto md:px-3"
                      onClick={() => setLanAdminTokenOpen(true)}
                      type="button"
                      variant="ghost"
                    >
                      <KeyIcon
                        className={
                          hasLanAdminToken
                            ? "size-4 text-emerald-600 dark:text-emerald-400"
                            : "size-4"
                        }
                      />
                      <span className="hidden md:inline">Admin access</span>
                    </Button>
                  ) : null}
	                <Button
	                  aria-label={
	                    isTemporaryChat ? "Exit temporary chat" : "Enter temporary chat"
	                  }
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
                  {adminEnabled ? (
                    <Button
                      asChild
                      className="h-8 w-9 px-0"
                      data-testid="admin:open"
                      title="Admin"
                      variant="outline"
                    >
                      <Link aria-label="Open admin" href="/admin">
                        <ShieldIcon className="size-4" />
                      </Link>
                    </Button>
                  ) : null}
	              </div>
	            </div>
	          </header>

          <StickToBottom
            className="relative min-h-0 flex-1 overflow-hidden"
            contextRef={stickToBottomContextRef}
            data-testid="chat:transcript"
            initial="instant"
            resize="smooth"
          >
            <StickToBottom.Content className="w-full py-4 pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] sm:py-6 sm:pl-[max(1rem,env(safe-area-inset-left,0px))] sm:pr-[max(1rem,env(safe-area-inset-right,0px))] md:py-8 md:pl-[max(1.5rem,env(safe-area-inset-left,0px))] md:pr-[max(1.5rem,env(safe-area-inset-right,0px))]">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
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
                    const hasMemoryPromptCard =
                      role === "assistant" &&
                      parts.some((p) => p.type === "tool-displayMemoryPrompt");
                    const suppressAssistantText =
                      hasMemoryAnswerCard || hasMemoryPromptCard;

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
                            if (part.type === "file") {
                              const attachmentId = parseAttachmentUrl(part.url);
                              const downloadUrl =
                                attachmentId && activeProfile
                                  ? `/api/attachments/${attachmentId}?profileId=${encodeURIComponent(activeProfile.id)}`
                                  : "";
                              const filename =
                                typeof part.filename === "string" ? part.filename : "";

                              return (
                                <div
                                  className="flex items-center gap-2"
                                  key={`${id}-${index}`}
                                >
                                  <MessageAttachment data={part} />
                                  <div className="min-w-0">
                                    <div className="truncate text-sm">
                                      {filename || "Attachment"}
                                    </div>
                                    {downloadUrl ? (
                                      <a
                                        className="text-xs underline underline-offset-4 opacity-80 hover:opacity-100"
                                        data-testid={`attachment:download:${attachmentId}`}
                                        href={downloadUrl}
                                      >
                                        Download
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            }

                            if (part.type === "text") {
                              if (suppressAssistantText) return null;
                              return (
                                <MessageResponse
                                  className="prose-neutral dark:prose-invert"
                                  key={`${id}-${index}`}
                                >
                                  {part.text}
                                </MessageResponse>
                              );
                            }

                            if (part.type === "reasoning") {
                              if (suppressAssistantText) return null;
                              const text = typeof part.text === "string" ? part.text : "";
                              if (!text.trim()) return null;

                              return (
                                <Reasoning
                                  defaultOpen={false}
                                  isStreaming={part.state === "streaming"}
                                  key={`${id}-${index}`}
                                >
                                  <ReasoningTrigger />
                                  <ReasoningContent>{text}</ReasoningContent>
                                </Reasoning>
                              );
                            }

                            if (part.type === "tool-displayMemoryAnswer") {
                              switch (part.state) {
                                case "input-streaming":
                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
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
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Memory error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayMemoryPrompt") {
                              const payload =
                                part.state === "output-available"
                                  ? part.output
                                  : part.input;
                              const content =
                                typeof (payload as { content?: unknown })?.content ===
                                "string"
                                  ? (payload as { content: string }).content
                                  : "";

                              switch (part.state) {
                                case "input-streaming":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "input-available":
                                case "output-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <MemoryPromptCard
                                        content={content}
                                        disabled={
                                          status !== "ready" || !chatRequestBody
                                        }
                                        onCancel={() => sendMemoryDecision("cancel")}
                                        onConfirm={() =>
                                          sendMemoryDecision("confirm")
                                        }
                                      />
                                    </div>
                                  );
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Memory error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayList") {
                              switch (part.state) {
                                case "input-streaming":
                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available": {
                                  const output = part.output as TaskList | undefined;
                                  if (!output || typeof output !== "object") return null;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <ListCard
                                        list={output}
                                        profileId={activeProfile?.id ?? ""}
                                      />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        List error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayListsOverview") {
                              switch (part.state) {
                                case "input-streaming":
                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available": {
                                  const output = part.output as
                                    | ListsOverviewToolOutput
                                    | undefined;
                                  if (!output || typeof output !== "object") return null;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <ListsOverviewCard
                                        {...output}
                                        onOpenList={sendOpenList}
                                      />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Lists overview error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayAgenda") {
                              switch (part.state) {
                                case "input-streaming":
                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available": {
                                  const output = part.output as
                                    | AgendaToolOutput
                                    | undefined;
                                  if (!output || typeof output !== "object") return null;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <AgendaCard output={output} />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Agenda error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

	                            if (part.type === "tool-displayTimezones") {
	                              switch (part.state) {
	                                case "input-streaming":
	                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available": {
                                  const output = part.output as
                                    | TimezonesToolOutput
                                    | undefined;
                                  if (!output || typeof output !== "object") return null;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <TimezonesCard {...output} />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Timezones error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
	                              }
	                            }

	                            if (part.type === "tool-displayCurrentDateTime") {
	                              switch (part.state) {
	                                case "input-streaming":
	                                case "input-available":
	                                  return (
	                                    <ToolCallLine
	                                      key={`${id}-${index}`}
	                                      state={part.state}
	                                      type={part.type}
	                                    />
	                                  );
	                                case "output-available": {
	                                  const output = part.output as
	                                    | CurrentDateTimeToolOutput
	                                    | undefined;
	                                  if (!output || typeof output !== "object") return null;
	                                  return (
	                                    <div className="space-y-2" key={`${id}-${index}`}>
	                                      <ToolCallLine state={part.state} type={part.type} />
	                                      <CurrentDateTimeCard {...output} />
	                                    </div>
	                                  );
	                                }
	                                case "output-error":
	                                  return (
	                                    <div className="space-y-2" key={`${id}-${index}`}>
	                                      <ToolCallLine state={part.state} type={part.type} />
	                                      <div className="text-sm text-destructive">
	                                        Current date/time error: {part.errorText}
	                                      </div>
	                                    </div>
	                                  );
	                                default:
	                                  return null;
	                              }
	                            }

                            if (
                              part.type === "tool-displayUrlSummary" ||
                              part.type === "tool-summarizeURL"
                            ) {
                              switch (part.state) {
                                case "input-streaming":
                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available": {
                                  const output = part.output as
                                    | UrlSummaryToolOutput
                                    | undefined;
                                  if (!output || typeof output !== "object") return null;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <UrlSummaryCard {...output} />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Summary error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayNotes") {
                              switch (part.state) {
                                case "input-streaming":
                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available": {
                                  const output = part.output as
                                    | NotesToolOutput
                                    | undefined;
                                  if (!output || typeof output !== "object") return null;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <NotesCard
                                        {...output}
                                        profileId={activeProfile?.id ?? ""}
                                      />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Notes error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-bash") {
                              const input = part.input as { command?: unknown } | undefined;
                              const command =
                                typeof input?.command === "string" ? input.command : "";

                              switch (part.state) {
                                case "input-streaming":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "input-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        command={command}
                                        kind="bash"
                                        result={{ stdout: "", stderr: "", exitCode: -1 }}
                                        state="running"
                                      />
                                    </div>
                                  );
                                case "output-available": {
                                  const output = part.output as
                                    | {
                                        stdout?: unknown;
                                        stderr?: unknown;
                                        exitCode?: unknown;
                                        stdoutTruncatedChars?: unknown;
                                        stderrTruncatedChars?: unknown;
                                      }
                                    | undefined;
                                  const exitCodeRaw = output?.exitCode;
                                  const exitCode =
                                    typeof exitCodeRaw === "number"
                                      ? exitCodeRaw
                                      : Number(exitCodeRaw ?? -1);
                                  const running = exitCode === -1;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        command={command}
                                        kind="bash"
                                        result={{
                                          stdout:
                                            typeof output?.stdout === "string"
                                              ? output.stdout
                                              : "",
                                          stderr:
                                            typeof output?.stderr === "string"
                                              ? output.stderr
                                              : "",
                                          exitCode,
                                        }}
                                        state={running ? "running" : "ok"}
                                      />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        command={command}
                                        errorText={part.errorText}
                                        kind="bash"
                                        state="error"
                                      />
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-readFile") {
                              const input = part.input as { path?: unknown } | undefined;
                              const filePath = typeof input?.path === "string" ? input.path : "";

                              switch (part.state) {
                                case "input-streaming":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "input-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        kind="readFile"
                                        path={filePath}
                                        state="running"
                                      />
                                    </div>
                                  );
                                case "output-available": {
                                  const output = part.output as
                                    | { content?: unknown }
                                    | undefined;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        content={
                                          typeof output?.content === "string"
                                            ? output.content
                                            : ""
                                        }
                                        kind="readFile"
                                        path={filePath}
                                        state="ok"
                                      />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        errorText={part.errorText}
                                        kind="readFile"
                                        path={filePath}
                                        state="error"
                                      />
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-writeFile") {
                              const input = part.input as
                                | { path?: unknown; content?: unknown }
                                | undefined;
                              const filePath = typeof input?.path === "string" ? input.path : "";
                              const content =
                                typeof input?.content === "string" ? input.content : "";

                              switch (part.state) {
                                case "input-streaming":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "input-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        contentLength={content.length}
                                        kind="writeFile"
                                        path={filePath}
                                        state="running"
                                      />
                                    </div>
                                  );
                                case "output-available": {
                                  const output = part.output as
                                    | { success?: unknown }
                                    | undefined;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        contentLength={content.length}
                                        kind="writeFile"
                                        path={filePath}
                                        state="ok"
                                        success={output?.success === true}
                                      />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <BashToolCard
                                        contentLength={content.length}
                                        errorText={part.errorText}
                                        kind="writeFile"
                                        path={filePath}
                                        state="error"
                                      />
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-skillsActivate") {
                              const input = part.input as { name?: unknown } | undefined;
                              const inputName =
                                typeof input?.name === "string" ? input.name : "";
                              const output = part.output as
                                | { name?: unknown; frontmatter?: unknown; body?: unknown }
                                | undefined;
                              const outputName =
                                typeof output?.name === "string" ? output.name : "";
                              const skillName = outputName || inputName;
                              const body =
                                typeof output?.body === "string" ? output.body : "";

                              switch (part.state) {
                                case "input-streaming":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "input-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <SkillsToolCard
                                        body=""
                                        frontmatter={{}}
                                        kind="activate"
                                        skillName={skillName}
                                        state="running"
                                      />
                                    </div>
                                  );
                                case "output-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <SkillsToolCard
                                        body={body}
                                        frontmatter={output?.frontmatter}
                                        kind="activate"
                                        skillName={skillName}
                                        state="ok"
                                      />
                                    </div>
                                  );
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <SkillsToolCard
                                        errorText={part.errorText}
                                        kind="activate"
                                        skillName={skillName}
                                        state="error"
                                      />
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-skillsReadResource") {
                              const input = part.input as
                                | { name?: unknown; path?: unknown }
                                | undefined;
                              const inputName =
                                typeof input?.name === "string" ? input.name : "";
                              const inputPath =
                                typeof input?.path === "string" ? input.path : "";
                              const output = part.output as
                                | { name?: unknown; path?: unknown; content?: unknown }
                                | undefined;
                              const outputName =
                                typeof output?.name === "string" ? output.name : "";
                              const outputPath =
                                typeof output?.path === "string" ? output.path : "";
                              const content =
                                typeof output?.content === "string" ? output.content : "";

                              const skillName = outputName || inputName;
                              const resourcePath = outputPath || inputPath;

                              switch (part.state) {
                                case "input-streaming":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "input-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <SkillsToolCard
                                        content=""
                                        kind="readResource"
                                        resourcePath={resourcePath}
                                        skillName={skillName}
                                        state="running"
                                      />
                                    </div>
                                  );
                                case "output-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <SkillsToolCard
                                        content={content}
                                        kind="readResource"
                                        resourcePath={resourcePath}
                                        skillName={skillName}
                                        state="ok"
                                      />
                                    </div>
                                  );
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <SkillsToolCard
                                        errorText={part.errorText}
                                        kind="readResource"
                                        resourcePath={resourcePath}
                                        skillName={skillName}
                                        state="error"
                                      />
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayWeather") {
                              switch (part.state) {
                                case "input-streaming":
                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <Weather {...(part.output as WeatherToolOutput)} />
                                    </div>
                                  );
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Weather error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-displayWeatherForecast") {
                              switch (part.state) {
                                case "input-streaming":
                                case "input-available":
                                  return (
                                    <ToolCallLine
                                      key={`${id}-${index}`}
                                      state={part.state}
                                      type={part.type}
                                    />
                                  );
                                case "output-available":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <WeatherForecast
                                        {...(part.output as WeatherForecastToolOutput)}
                                      />
                                    </div>
                                  );
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        Forecast error: {part.errorText}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (
                              typeof part.type === "string" &&
                              part.type.startsWith("tool-") &&
                              typeof (part as { state?: unknown }).state === "string"
                            ) {
                              const toolPart = part as {
                                type: string;
                                state: string;
                                input?: unknown;
                                output?: unknown;
                                errorText?: string;
                              };
                              const toolName = toolNameFromPartType(toolPart.type);

                              return (
                                <Tool data-testid={`tool:${toolName}`} key={`${id}-${index}`}>
                                  <ToolHeader
                                    title={`Calling tool: "${toolName}"`}
                                    type={toolPart.type as never}
                                    state={toolPart.state as never}
                                  />
                                  <ToolContent>
                                    <ToolInput input={toolPart.input} />
                                    <ToolOutput
                                      errorText={toolPart.errorText ?? ""}
                                      output={toolPart.output}
                                    />
                                  </ToolContent>
                                </Tool>
                              );
                            }

                            return null;
                          })}
                        </MessageContent>

                        {role === "assistant" ? (() => {
                          const usage = metadata?.usage;
                          const reasoningTokens =
                            typeof usage?.outputTokenDetails?.reasoningTokens ===
                            "number"
                              ? usage.outputTokenDetails.reasoningTokens
                              : typeof usage?.reasoningTokens === "number"
                                ? usage.reasoningTokens
                                : 0;
                          if (!reasoningTokens) return null;
                          return (
                            <div className="text-xs text-muted-foreground">
                              {" "}Reasoning tokens: {reasoningTokens}
                            </div>
                          );
                        })() : null}

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
                        scrollTranscriptToBottom("smooth");
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
            <ConversationScrollButton />
          </StickToBottom>

			          <div className="shrink-0 bg-transparent pb-[calc(0.75rem+max(var(--rc-safe-bottom),var(--rc-keyboard-inset)))] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] pt-3 sm:pl-[max(1rem,env(safe-area-inset-left,0px))] sm:pr-[max(1rem,env(safe-area-inset-right,0px))] md:pb-[calc(1rem+max(var(--rc-safe-bottom),var(--rc-keyboard-inset)))] md:pl-[max(1.5rem,env(safe-area-inset-left,0px))] md:pr-[max(1.5rem,env(safe-area-inset-right,0px))] md:pt-4">
		            <div className="mx-auto w-full max-w-5xl">
		              <PromptInput
		                accept="text/plain,text/markdown,text/csv,application/json,application/pdf,.txt,.md,.markdown,.csv,.json,.pdf"
		                className={
		                  "composer-scale bg-sidebar " +
		                  (isTemporaryChat
		                    ? "[&_[data-slot=input-group]]:border-destructive [&_[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:border-destructive [&_[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:ring-destructive/30"
		                    : "")
		                }
                  convertBlobUrlsToDataUrls={false}
                  maxFileSize={2_000_000}
                  maxFiles={3}
                  multiple
                  onError={(err) => setAttachmentUploadError(err.message)}
	                onSubmit={async ({ text, files }) => {
	                  if (!activeProfile) return;
	                  if (status !== "ready") return;
                  if (!chatRequestBody) return;

                  setAttachmentUploadError(null);

                  const rawFiles = (files as Array<{ file?: unknown }> | undefined)
                    ?.map((f) => (f?.file instanceof File ? f.file : null))
                    .filter((f): f is File => f != null) ?? [];

                  let uploadedParts: Array<{
                    type: "file";
                    url: string;
                    filename?: string;
                    mediaType: string;
                  }> = [];

                  try {
                    if (rawFiles.length > 0) {
                      setAttachmentUploading(true);
                      const form = new FormData();
                      form.set("profileId", activeProfile.id);
                      if (isTemporaryChat) {
                        form.set("temporarySessionId", temporarySessionId);
                      } else if (activeChat) {
                        form.set("chatId", activeChat.id);
                      } else {
                        throw new Error("Missing chatId.");
                      }

                      for (const file of rawFiles) {
                        form.append("files", file, file.name);
                      }

                      const res = await fetch("/api/attachments", {
                        method: "POST",
                        body: form,
                      });
                      const data = (await res.json().catch(() => null)) as
                        | {
                            attachments?: Array<{
                              id?: unknown;
                              filename?: unknown;
                              mediaType?: unknown;
                              attachmentUrl?: unknown;
                            }>;
                            error?: string;
                          }
                        | null;

                      if (!res.ok || !Array.isArray(data?.attachments)) {
                        throw new Error(data?.error || "Failed to upload attachments.");
                      }

                      uploadedParts = data.attachments
                        .map((a) => ({
                          type: "file" as const,
                          url:
                            typeof a.attachmentUrl === "string" ? a.attachmentUrl : "",
                          mediaType:
                            typeof a.mediaType === "string" ? a.mediaType : "",
                          filename:
                            typeof a.filename === "string" ? a.filename : undefined,
                        }))
                        .filter((p) => p.url && p.mediaType);
                    }

                    sendMessage(
                      {
                        text: String(text ?? ""),
                        ...(uploadedParts.length > 0 ? { files: uploadedParts } : {}),
                        metadata: { createdAt: new Date().toISOString() },
                      },
                      {
                        body: chatRequestBody,
                      }
                    ).catch(() => {});
                    queueScrollTranscriptToBottom("smooth");
                  } catch (err) {
                    setAttachmentUploadError(
                      err instanceof Error ? err.message : "Failed to upload attachments."
                    );
                    throw err;
                  } finally {
                    setAttachmentUploading(false);
                  }

                  setInput("");
                  setPromptHistoryCursor(Number.MAX_SAFE_INTEGER);
                  setPromptHistoryDraft("");
                }}
              >
                <ComposerAttachmentsCountBridge
                  onCountChange={setComposerAttachmentCount}
                />
                <PromptInputAttachments>
                  {(attachment) => <PromptInputAttachment data={attachment} />}
                </PromptInputAttachments>
                {attachmentUploadError ? (
                  <div className="px-3 pb-2 text-sm text-destructive">
                    {attachmentUploadError}
                  </div>
                ) : null}
                <PromptInputTextarea
                  className="max-h-[30vh] overflow-y-auto"
                  data-testid="composer:textarea"
                  name="message"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  value={input}
                />

                <div className="flex items-center justify-end gap-2 pt-2 pr-2">
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

                  {(status === "submitted" || status === "streaming") && (
                    <button
                      className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
                      data-testid="composer:stop"
                      onClick={() => stop()}
                      type="button"
                    >
                      Stop
                    </button>
                  )}

	                <PromptInputSubmit
	                  className="h-16 w-16 dark:text-white"
	                  data-testid="composer:submit"
	                  disabled={!canSend || !chatRequestBody}
	                  status={status}
	                  variant={isTemporaryChat ? "destructive" : "default"}
	                />
                </div>

                <div className="mt-2 flex min-h-10 basis-full items-center justify-between gap-2 border-t px-2 pt-2 pb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <PromptInputActionMenu>
                      <PromptInputActionMenuTrigger
                        aria-label="Add attachments"
                        disabled={status !== "ready"}
                        title="Add files"
                      />
                      <PromptInputActionMenuContent>
                        <PromptInputActionAddAttachments />
                      </PromptInputActionMenuContent>
                    </PromptInputActionMenu>

                    {selectedModel?.capabilities?.reasoning &&
                    reasoningOptions.length > 0 ? (
                      <div className="min-w-0 overflow-x-auto">
                        <ButtonGroup aria-label="Reasoning level">
                          {(
                            [
                              "auto" as const,
                              ...reasoningOptions,
                            ] satisfies ReasoningEffortChoice[]
                          ).map((option) => {
                            const label =
                              option === "auto"
                                ? "Auto"
                                : option === "minimal"
                                  ? "Min"
                                  : option === "medium"
                                    ? "Med"
                                    : option === "high"
                                      ? "High"
                                      : "Low";

                            const selected = reasoningEffort === option;
                            const dim = !canSend || !chatRequestBody;
                            return (
                              <Button
                                aria-pressed={selected}
                                className={
                                  // Fix width so toggling font-weight doesn't cause layout shift.
                                  "h-8 min-w-12 px-2 text-[11px] " +
                                  (selected
                                    ? "relative z-10 shadow-none " +
                                      (canSend && chatRequestBody ? "font-semibold " : "")
                                    : "")
                                  +
                                  (selected && dim
                                    ? isTemporaryChat
                                      ? "bg-destructive/50 hover:bg-destructive/50"
                                      : "bg-primary/50 hover:bg-primary/50"
                                    : "")
                                  +
                                  // Match the send button's disabled "dim" behavior when canSend is false.
                                  (dim
                                    ? "text-foreground/60 hover:text-foreground/60"
                                    : selected
                                      ? "text-foreground hover:text-foreground"
                                      : "")
                                }
                                data-testid={`reasoning-option:${option}`}
                                data-selected={selected ? "true" : "false"}
                                disabled={status !== "ready"}
                                key={option}
                                onClick={() => setReasoningEffort(option)}
                                type="button"
                                variant={
                                  selected
                                    ? isTemporaryChat
                                      ? "destructive"
                                      : "default"
                                    : "outline"
                                }
                              >
                                {label}
                              </Button>
                            );
                          })}
                        </ButtonGroup>
                      </div>
                    ) : null}
                  </div>

                  {!isTemporaryChat && activeChat ? (
	                    <button
	                      aria-label="Chat settings"
	                      className="inline-flex size-10 items-center justify-center rounded-md border text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
	                      data-testid="chat:settings-open"
	                      disabled={status !== "ready" || !canManageActiveChat}
	                      onClick={() => openChatSettings()}
	                      title="Chat settings"
	                      type="button"
	                    >
                      <SlidersHorizontalIcon className="size-4" />
                    </button>
                  ) : (
                    <div aria-hidden="true" className="size-10" />
                  )}
                </div>
	              </PromptInput>
	            </div>
		          </div>
	        </main>
	      </div>

	        <Dialog
	          onOpenChange={(open) => {
	            setSidebarOpen(open);
	            if (open) return;
	            window.setTimeout(() => focusComposer({ toEnd: true }), 0);
	          }}
	          open={sidebarOpen}
	        >
	          <DialogContent
	            className="left-0 top-0 grid h-dvh w-[18rem] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none border-0 border-r p-0 data-[state=closed]:slide-out-to-left-2 data-[state=open]:slide-in-from-left-2 md:hidden"
	            data-testid="sidebar:drawer"
	            showCloseButton={false}
	          >
		            <DialogTitle className="sr-only">Menu</DialogTitle>
		            {renderSidebar("drawer")}
		          </DialogContent>
	        </Dialog>

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
	                  Saved after confirmation (ask me to remember/save in chat or use the Memorize action).
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

      <Dialog
        onOpenChange={(open) => {
          setLanAdminTokenOpen(open);
          if (!open) return;
          const token = readLanAdminToken();
          setLanAdminTokenDraft(token);
          setHasLanAdminToken(Boolean(token));
          if (typeof window !== "undefined") {
            const remember = Boolean(
              !window.sessionStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY) &&
                window.localStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY)
            );
            setLanAdminTokenRemember(remember);
          }
        }}
        open={lanAdminTokenOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin access</DialogTitle>
          </DialogHeader>

          {!bashToolsLanAccessEnabled ? (
            <div className="text-sm text-muted-foreground">
              Admin access is not configured for LAN access.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                For safety, some admin features are protected by a shared admin token when you
                access RemcoChat over the network. Enter the token for this server to unlock
                admin-only features in this browser (including Bash tool access).
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Admin token</div>
                <Input
                  autoFocus
                  data-testid="bash-tools:lan-admin-token"
                  onChange={(e) => setLanAdminTokenDraft(e.target.value)}
                  placeholder="REMCOCHAT_ADMIN_TOKEN"
                  type={lanAdminTokenVisible ? "text" : "password"}
                  value={lanAdminTokenDraft}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => setLanAdminTokenVisible((v) => !v)}
                    type="button"
                    variant="secondary"
                  >
                    {lanAdminTokenVisible ? "Hide" : "Show"}
                  </Button>
                  <Button
                    onClick={() => {
                      clearLanAdminToken();
                      setLanAdminTokenDraft("");
                      setHasLanAdminToken(false);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-md border bg-card px-3 py-2">
                <button
                  aria-checked={lanAdminTokenRemember}
                  aria-label="Remember token"
                  className={
                    "relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                    (lanAdminTokenRemember ? "bg-primary" : "bg-muted")
                  }
                  onClick={() => setLanAdminTokenRemember((v) => !v)}
                  role="switch"
                  title={
                    lanAdminTokenRemember
                      ? "Remember: On (localStorage)"
                      : "Remember: Off (session only)"
                  }
                  type="button"
                >
                  <span
                    className={
                      "pointer-events-none inline-block size-5 rounded-full bg-white shadow-sm transition-transform " +
                      (lanAdminTokenRemember ? "translate-x-5" : "translate-x-0.5")
                    }
                  />
                </button>
                <div className="min-w-0">
                  <div className="text-sm font-medium">Remember on this device</div>
                  <div className="text-xs text-muted-foreground">
                    Off stores in sessionStorage (cleared when the tab closes). On
                    stores in localStorage (persists across restarts).
                  </div>
                </div>
              </div>

              <div className="rounded-md border bg-card p-3">
                <div className="text-sm font-medium">Verification</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Bash tools verification (from the last <code>/api/chat</code> response header):
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <code className="rounded bg-muted px-2 py-1">
                    x-remcochat-bash-tools-enabled=
                    {bashToolsEnabledHeader ?? "?"}
                  </code>
                  <code className="rounded bg-muted px-2 py-1">
                    token={hasLanAdminToken ? "present" : "absent"}
                  </code>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setLanAdminTokenOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    writeLanAdminToken(lanAdminTokenDraft, lanAdminTokenRemember);
                    const token = readLanAdminToken();
                    setHasLanAdminToken(Boolean(token));
                    setLanAdminTokenOpen(false);
                  }}
                  type="button"
                >
                  Save locally
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setRenameChatOpen} open={renameChatOpen}>
        <DialogContent data-testid="chat:rename-dialog">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              autoFocus
              data-testid="chat:rename-input"
              onChange={(e) => {
                setRenameChatDraft(e.target.value);
                if (renameChatError) setRenameChatError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameChatOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (canSaveRenameChat) {
                    renameChatTitle();
                  } else if (!renameChatValidation.ok) {
                    setRenameChatError(renameChatValidation.error);
                  }
                }
              }}
              placeholder="Chat title"
              value={renameChatDraft}
            />

            {renameChatError ? (
              <div className="text-sm text-destructive">{renameChatError}</div>
            ) : !renameChatValidation.ok ? (
              <div className="text-sm text-destructive">
                {renameChatValidation.error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="chat:rename-cancel"
                disabled={renameChatSaving}
                onClick={() => setRenameChatOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                data-testid="chat:rename-save"
                disabled={!canSaveRenameChat}
                onClick={() => renameChatTitle()}
                type="button"
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setNewFolderOpen} open={newFolderOpen}>
        <DialogContent data-testid="folder:new-dialog">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              autoFocus
              data-testid="folder:new-input"
              onChange={(e) => {
                setNewFolderDraft(e.target.value);
                if (newFolderError) setNewFolderError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setNewFolderOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  createFolderByName();
                }
              }}
              placeholder="Folder name"
              value={newFolderDraft}
            />

            {newFolderError ? (
              <div className="text-sm text-destructive">{newFolderError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="folder:new-cancel"
                disabled={newFolderSaving}
                onClick={() => setNewFolderOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                data-testid="folder:new-create"
                disabled={
                  !activeProfile ||
                  status !== "ready" ||
                  newFolderSaving ||
                  !newFolderDraft.trim() ||
                  newFolderDraft.trim().length > 60
                }
                onClick={() => createFolderByName()}
                type="button"
              >
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setRenameFolderOpen} open={renameFolderOpen}>
        <DialogContent data-testid="folder:rename-dialog">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              autoFocus
              data-testid="folder:rename-input"
              onChange={(e) => {
                setRenameFolderDraft(e.target.value);
                if (renameFolderError) setRenameFolderError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameFolderOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveRenameFolder();
                }
              }}
              placeholder="Folder name"
              value={renameFolderDraft}
            />

            {renameFolderError ? (
              <div className="text-sm text-destructive">{renameFolderError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="folder:rename-cancel"
                disabled={renameFolderSaving}
                onClick={() => setRenameFolderOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                data-testid="folder:rename-save"
                disabled={
                  !activeProfile ||
                  status !== "ready" ||
                  renameFolderSaving ||
                  !renameFolderId ||
                  !renameFolderDraft.trim() ||
                  renameFolderDraft.trim().length > 60
                }
                onClick={() => saveRenameFolder()}
                type="button"
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDeleteFolderOpen} open={deleteFolderOpen}>
        <DialogContent data-testid="folder:delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete folder?</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Chats in this folder will be moved to the root level.
            </div>

            {deleteFolderName ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                {deleteFolderName}
              </div>
            ) : null}

            {deleteFolderError ? (
              <div className="text-sm text-destructive">{deleteFolderError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="folder:delete-cancel"
                disabled={deleteFolderSaving}
                onClick={() => setDeleteFolderOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                data-testid="folder:delete-confirm"
                disabled={
                  !activeProfile ||
                  status !== "ready" ||
                  deleteFolderSaving ||
                  !deleteFolderId
                }
                onClick={() => confirmDeleteFolder()}
                type="button"
                variant="destructive"
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setShareFolderOpen} open={shareFolderOpen}>
        <DialogContent data-testid="folder:share-dialog">
          <DialogHeader>
            <DialogTitle>Share folder</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              This will share all chats in this folder.
            </div>

            {shareFolderName ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                {shareFolderName}
              </div>
            ) : null}

            <Input
              autoFocus
              data-testid="folder:share-target"
              onChange={(e) => {
                setShareFolderTarget(e.target.value);
                if (shareFolderError) setShareFolderError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setShareFolderOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmShareFolder();
                }
              }}
              placeholder="Target profile name or id"
              value={shareFolderTarget}
            />

            {shareFolderError ? (
              <div className="text-sm text-destructive">{shareFolderError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="folder:share-cancel"
                disabled={shareFolderSaving}
                onClick={() => setShareFolderOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                data-testid="folder:share-submit"
                disabled={
                  !activeProfile ||
                  status !== "ready" ||
                  shareFolderSaving ||
                  !shareFolderId ||
                  !shareFolderTarget.trim()
                }
                onClick={() => confirmShareFolder()}
                type="button"
              >
                Share
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setManageSharingOpen} open={manageSharingOpen}>
        <DialogContent data-testid="folder:manage-sharing-dialog">
          <DialogHeader>
            <DialogTitle>Manage sharing</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {manageSharingFolderName ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                {manageSharingFolderName}
              </div>
            ) : null}

            {manageSharingLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : null}

            {manageSharingError ? (
              <div className="text-sm text-destructive">{manageSharingError}</div>
            ) : null}

            {!manageSharingLoading && manageSharingMembers.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Not shared with any profiles yet.
              </div>
            ) : null}

            {!manageSharingLoading && manageSharingMembers.length > 0 ? (
              <div className="space-y-2">
                {manageSharingMembers.map((m) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
                    key={m.profileId}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.profileId}</div>
                    </div>
                    <Button
                      className="h-8 shrink-0"
                      disabled={manageSharingSaving}
                      onClick={() => stopSharingFolderWithMember(m)}
                      type="button"
                      variant="destructive"
                    >
                      Stop sharing
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button
                data-testid="folder:manage-sharing-close"
                disabled={manageSharingSaving}
                onClick={() => setManageSharingOpen(false)}
                type="button"
                variant="ghost"
              >
                Close
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
