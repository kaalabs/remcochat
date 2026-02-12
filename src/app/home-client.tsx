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
import { useI18n } from "@/components/i18n-provider";
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
  NotesToolOutput,
  OvNlToolOutput,
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
import { shouldSuppressAssistantTextForOvOutput } from "@/lib/ov-nl-recovery";
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
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
import { OvNlCard } from "@/components/ov-nl-card";
import { ConversationScrollButton } from "@/components/ai-elements/conversation";
	import type { WeatherToolOutput } from "@/ai/weather";
	import type { WeatherForecastToolOutput } from "@/ai/weather";
	import type { CurrentDateTimeToolOutput } from "@/ai/current-date-time";
	import type { TimezonesToolOutput } from "@/ai/timezones";
	import type { UrlSummaryToolOutput } from "@/ai/url-summary";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ProfileAvatarPositioner } from "@/components/profile-avatar-positioner";
import {
		  ArchiveIcon,
		  BookmarkIcon,
		  ChevronDownIcon,
      FolderIcon,
      FolderOpenIcon,
      FolderPlusIcon,
      PanelLeftCloseIcon,
      PanelLeftOpenIcon,
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
import { getProfileAvatarSrc } from "@/lib/profile-avatar";
import {
  ALLOWED_PROFILE_AVATAR_MEDIA_TYPES,
  MAX_PROFILE_AVATAR_SIZE_BYTES,
} from "@/lib/profile-avatar-constraints";
import {
  clampDesktopSidebarWidth,
  DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX,
  DESKTOP_SIDEBAR_STORAGE_KEY,
  parseDesktopSidebarPrefs,
} from "@/lib/sidebar-shell";
import {
  rotateOpeningMessageCache,
  storeOpeningMessageNext,
} from "@/lib/opening-message-cache";
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

type AdminAccessResponse = {
  isLocalhost: boolean;
  requiredConfigured: boolean;
  tokenProvided: boolean;
  allowed: boolean;
  reason: string;
};

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
  const { t } = useI18n();
  const toolName = toolNameFromPartType(props.type);
  const showSpinner =
    props.state === "input-streaming" ||
    props.state === "input-available" ||
    props.state === "approval-requested";

  return (
    <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      {showSpinner ? <Loader size={14} /> : null}
      {t("tool.calling", { toolName })}
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
  const onCountChange = props.onCountChange;
  useEffect(() => {
    onCountChange(attachments.files.length);
  }, [attachments.files.length, onCountChange]);
  return null;
}

export type HomeClientProps = {
  adminEnabled: boolean;
  appVersion: string;
  lanAdminAccessEnabled: boolean;
  initialActiveProfileId: string;
  initialProfiles: Profile[];
  initialChats: Chat[];
};

export function HomeClient({
  adminEnabled,
  appVersion,
  lanAdminAccessEnabled,
  initialActiveProfileId,
  initialProfiles,
  initialChats,
}: HomeClientProps) {
  const { setUiLanguage, t, uiLanguage } = useI18n();

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
  const [lanAdminTokenAllowed, setLanAdminTokenAllowed] = useState<
    boolean | null
  >(null);
  const [lanAdminTokenAllowedReason, setLanAdminTokenAllowedReason] =
    useState("");
  const [bashToolsEnabledHeader, setBashToolsEnabledHeader] = useState<
    "0" | "1" | null
  >(null);

  const verifyLanAdminToken = useCallback(async () => {
    if (!lanAdminAccessEnabled) {
      setLanAdminTokenAllowed(null);
      setLanAdminTokenAllowedReason("");
      return;
    }

    const token = readLanAdminToken();
    if (!token) {
      setLanAdminTokenAllowed(null);
      setLanAdminTokenAllowedReason("");
      return;
    }

    try {
      const res = await fetch("/api/admin/access", {
        cache: "no-store",
        headers: { "x-remcochat-admin-token": token },
      });
      const json = (await res.json().catch(() => null)) as AdminAccessResponse | null;
      if (!json || typeof json.allowed !== "boolean") {
        setLanAdminTokenAllowed(null);
        setLanAdminTokenAllowedReason("invalid_response");
        return;
      }

      setLanAdminTokenAllowed(json.allowed);
      setLanAdminTokenAllowedReason(typeof json.reason === "string" ? json.reason : "");
    } catch {
      setLanAdminTokenAllowed(null);
      setLanAdminTokenAllowedReason("network_error");
    }
  }, [lanAdminAccessEnabled, readLanAdminToken]);

  useEffect(() => {
    if (!lanAdminAccessEnabled) {
      setHasLanAdminToken(false);
      setLanAdminTokenDraft("");
      setLanAdminTokenAllowed(null);
      setLanAdminTokenAllowedReason("");
      return;
    }
    const token = readLanAdminToken();
    setHasLanAdminToken(Boolean(token));
    setLanAdminTokenDraft(token);
    verifyLanAdminToken().catch(() => {});
    if (typeof window !== "undefined") {
      const remember = Boolean(
        !window.sessionStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY) &&
          window.localStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY)
      );
      setLanAdminTokenRemember(remember);
    }
  }, [lanAdminAccessEnabled, readLanAdminToken, verifyLanAdminToken]);

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
        if (!lanAdminAccessEnabled) return headers;
        const token = readLanAdminToken();
        if (token) headers["x-remcochat-admin-token"] = token;
        return headers;
      },
    });
  }, [lanAdminAccessEnabled, instrumentedChatFetch, readLanAdminToken]);

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

  useEffect(() => {
    if (!activeProfile) return;
    if (activeProfile.uiLanguage === uiLanguage) return;
    setUiLanguage(activeProfile.uiLanguage);
  }, [activeProfile, setUiLanguage, uiLanguage]);

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
  }, [activeProfile, effectiveModelId, isAllowedModel, lastUsedModelKey]);

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
  const [openingMessage, setOpeningMessage] = useState<string>(
    t("home.empty.start_chat")
  );
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
  const [uiLanguageDraft, setUiLanguageDraft] = useState<Profile["uiLanguage"]>("en");
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);
  const [avatarDraftFile, setAvatarDraftFile] = useState<File | null>(null);
  const [avatarDraftObjectUrl, setAvatarDraftObjectUrl] = useState<string | null>(
    null
  );
  const [avatarPositionDraft, setAvatarPositionDraft] = useState<{ x: number; y: number }>({
    x: 50,
    y: 50,
  });
  const [avatarRemoveDraft, setAvatarRemoveDraft] = useState(false);
  const [avatarDraftError, setAvatarDraftError] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (!avatarDraftObjectUrl) return;
      try {
        URL.revokeObjectURL(avatarDraftObjectUrl);
      } catch {}
    };
  }, [avatarDraftObjectUrl]);

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
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [desktopSidebarWidthPx, setDesktopSidebarWidthPx] = useState(
    DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX
  );
  const [desktopSidebarPrefsLoaded, setDesktopSidebarPrefsLoaded] = useState(false);
  const [desktopSidebarResizing, setDesktopSidebarResizing] = useState(false);
  const desktopSidebarResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

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
	      const createRes = await fetch("/api/chats", {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({
	          profileId: input.profileId,
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
	  }, []);

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
    return activeProfileId ? `remcochat:folderGroupCollapsed:${activeProfileId}` : "";
  }, [activeProfileId]);

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

  useEffect(() => {
    const raw = window.localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY);
    const parsed = parseDesktopSidebarPrefs(raw);
    if (parsed) {
      setDesktopSidebarCollapsed(parsed.collapsed);
      setDesktopSidebarWidthPx(parsed.width);
    }
    setDesktopSidebarPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (!desktopSidebarPrefsLoaded) return;
    try {
      window.localStorage.setItem(
        DESKTOP_SIDEBAR_STORAGE_KEY,
        JSON.stringify({
          collapsed: desktopSidebarCollapsed,
          width: clampDesktopSidebarWidth(desktopSidebarWidthPx),
        })
      );
    } catch {
      // ignore write errors
    }
  }, [
    desktopSidebarCollapsed,
    desktopSidebarPrefsLoaded,
    desktopSidebarWidthPx,
  ]);

  useEffect(() => {
    if (!desktopSidebarResizing) return;
    const { cursor: prevCursor, userSelect: prevUserSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [desktopSidebarResizing]);

  const startDesktopSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (desktopSidebarCollapsed) return;
      if (event.button !== 0) return;
      desktopSidebarResizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: desktopSidebarWidthPx,
      };
      setDesktopSidebarResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [desktopSidebarCollapsed, desktopSidebarWidthPx]
  );

  const moveDesktopSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = desktopSidebarResizeRef.current;
      if (!state) return;
      if (state.pointerId !== event.pointerId) return;
      const delta = event.clientX - state.startX;
      const nextWidth = clampDesktopSidebarWidth(state.startWidth + delta);
      setDesktopSidebarWidthPx(nextWidth);
      // Persist immediately so a fast reload doesn't miss the useEffect write.
      try {
        window.localStorage.setItem(
          DESKTOP_SIDEBAR_STORAGE_KEY,
          JSON.stringify({ collapsed: false, width: nextWidth })
        );
      } catch {
        // ignore
      }
      event.preventDefault();
    },
    []
  );

  const endDesktopSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = desktopSidebarResizeRef.current;
      if (!state) return;
      if (state.pointerId !== event.pointerId) return;
      desktopSidebarResizeRef.current = null;
      setDesktopSidebarResizing(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      event.preventDefault();
    },
    []
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
        body: JSON.stringify({
          name,
          defaultModelId: profileDefaultModelId,
          uiLanguage,
        }),
      });

      const data = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok || !data.profile) {
        throw new Error(data.error || t("error.profile.create_failed"));
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
        err instanceof Error ? err.message : t("error.profile.create_failed")
      );
    } finally {
      setCreating(false);
    }
  };

  const createChat = useCallback(async () => {
    const profileId = activeProfile?.id ?? "";
    if (!profileId) return;

	    if (status !== "ready") stop();
	    setIsTemporaryChat(false);

	    const res = await fetch("/api/chats", {
	      method: "POST",
	      headers: { "Content-Type": "application/json" },
	      body: JSON.stringify({
	        profileId,
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
	  }, [
	    activeProfile?.id,
	    status,
	    stop,
	  ]);

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
        throw new Error(data?.error || t("error.admin.reset_failed"));
      }
      setAdminResetConfirm("");
      setAdminOpen(false);
      await refreshProfiles();
    } catch (err) {
      setAdminError(
        err instanceof Error ? err.message : t("error.admin.reset_failed")
      );
    } finally {
      setAdminResetSaving(false);
    }
  }, [adminEnabled, adminResetConfirm, adminResetSaving, refreshProfiles, t]);

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
        throw new Error(data?.error || t("error.chat.delete_failed"));
      }

      refreshChats({
        profileId: activeProfile.id,
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
  }, [activeProfile, chats, deleteChatSaving, refreshChats, status, t]);

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
        throw new Error(data?.error || t("error.chat.rename_failed"));
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
        err instanceof Error ? err.message : t("error.chat.rename_failed")
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
    t,
  ]);

  const normalizeFolderNameDraft = useCallback((value: string) => {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }, []);

  const validateFolderNameDraft = useCallback(
    (value: string): { ok: true; name: string } | { ok: false; error: string } => {
      const name = normalizeFolderNameDraft(value);
      if (!name) return { ok: false, error: t("validation.folder.name_required") };
      if (name.length > 60) {
        return { ok: false, error: t("validation.folder.name_too_long") };
      }
      return { ok: true, name };
    },
    [normalizeFolderNameDraft, t]
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
	        throw new Error(data?.error || t("error.folder.create_failed"));
	      }

	      refreshFolders(activeProfile.id).catch(() => {});
	      setNewFolderOpen(false);
	    } catch (err) {
	      setNewFolderError(
	        err instanceof Error ? err.message : t("error.folder.create_failed")
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
	    t,
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
	        throw new Error(data?.error || t("error.folder.rename_failed"));
	      }

	      setFolders((prev) =>
	        prev.map((f) => (f.id === renameFolderId ? { ...f, name: next.name } : f))
	      );
	      refreshFolders(activeProfile.id).catch(() => {});
	      setRenameFolderOpen(false);
	    } catch (err) {
	      setRenameFolderError(
	        err instanceof Error ? err.message : t("error.folder.rename_failed")
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
	    t,
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
          body: JSON.stringify({ profileId: activeProfile.id, targetProfile: target }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null;
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || t("error.folder.share_failed"));
        }
        refreshFolders(activeProfile.id).catch(() => {});
        setShareFolderOpen(false);
      } catch (err) {
        setShareFolderError(
          err instanceof Error ? err.message : t("error.folder.share_failed")
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
      t,
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
            throw new Error(
              data?.error || t("error.folder.sharing_settings_load_failed")
            );
          }
          setManageSharingMembers(Array.isArray(data?.members) ? data!.members! : []);
        } catch (err) {
          setManageSharingError(
            err instanceof Error
              ? err.message
              : t("error.folder.sharing_settings_load_failed")
          );
        } finally {
          setManageSharingLoading(false);
        }
      },
      [activeProfile, t]
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
            throw new Error(data?.error || t("error.folder.stop_sharing_failed"));
          }
          setManageSharingMembers((prev) =>
            prev.filter((m) => m.profileId !== member.profileId)
          );
          refreshFolders(activeProfile.id).catch(() => {});
        } catch (err) {
          setManageSharingError(
            err instanceof Error
              ? err.message
              : t("error.folder.stop_sharing_failed")
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
        t,
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
        throw new Error(data?.error || t("error.folder.delete_failed"));
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
        err instanceof Error ? err.message : t("error.folder.delete_failed")
      );
    } finally {
      setDeleteFolderSaving(false);
    }
  }, [activeProfile, deleteFolderId, deleteFolderSaving, status, t]);

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
	          throw new Error(data?.error || t("error.folder.update_failed"));
	        }
	      } catch (err) {
	        setFolderError(
            err instanceof Error
              ? err.message
              : t("error.folder.update_failed")
          );
	        refreshFolders(activeProfile.id).catch(() => {});
	      }
    },
    [activeProfile, refreshFolders, status, t]
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
          throw new Error(data?.error || t("error.chat.move_failed"));
        }

        setChats((prev) => prev.map((c) => (c.id === chatId ? data.chat! : c)));
      } catch (err) {
        setFolderError(
          err instanceof Error ? err.message : t("error.chat.move_failed")
        );
      }
    },
    [activeProfile, status, t]
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

  const openingMessageFallback = t("home.empty.start_chat");

  useLayoutEffect(() => {
    if (messages.length !== 0) return;

    const rotation = rotateOpeningMessageCache(uiLanguage, openingMessageFallback);
    setOpeningMessage(rotation.displayed);

    const params = new URLSearchParams({ lang: uiLanguage });
    const exclude = [rotation.displayed, rotation.cache.next]
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
    if (exclude.length > 0) {
      params.set("exclude", exclude.join(","));
    }

    let canceled = false;

    fetch(`/api/chat/opening-message?${params.toString()}`, {
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) return null;
        return res.json().catch(() => null) as Promise<
          { message?: unknown } | null
        >;
      })
      .then((data) => {
        if (canceled) return;
        const nextMessage = String(data?.message ?? "").trim();
        if (!nextMessage) return;

        storeOpeningMessageNext(uiLanguage, {
          displayed: rotation.displayed,
          next: nextMessage,
          fallback: openingMessageFallback,
        });
      })
      .catch(() => {});

    return () => {
      canceled = true;
    };
  }, [messages.length, openingMessageFallback, uiLanguage]);

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
        throw new Error(data?.error || t("error.chat.persist_state_failed"));
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
        throw new Error(data.error || t("error.chat.fork_failed"));
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
      setEditError(err instanceof Error ? err.message : t("error.chat.fork_failed"));
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
    t,
    variantsByUserMessageId,
  ]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (!activeProfile) return;

    setSettingsError(null);
    setProfileInstructionsDraft(activeProfile.customInstructions ?? "");
    setMemoryEnabledDraft(Boolean(activeProfile.memoryEnabled));
    setUiLanguageDraft(activeProfile.uiLanguage ?? "en");
    setAvatarDraftError(null);
    setAvatarDraftFile(null);
    setAvatarDraftObjectUrl(null);
    setAvatarRemoveDraft(false);
    setAvatarPositionDraft(activeProfile.avatar?.position ?? { x: 50, y: 50 });
    if (avatarFileInputRef.current) {
      avatarFileInputRef.current.value = "";
    }

    fetch(`/api/profiles/${activeProfile.id}/memory`)
      .then((r) => r.json())
      .then((data: { memory?: MemoryItem[] }) => {
        setMemoryItems(Array.isArray(data.memory) ? data.memory : []);
      })
      .catch(() => {});
  }, [activeProfile, settingsOpen]);

  const avatarMaxMb = Math.max(1, Math.ceil(MAX_PROFILE_AVATAR_SIZE_BYTES / 1_000_000));

  const chooseAvatarFile = useCallback(() => {
    setAvatarDraftError(null);
    avatarFileInputRef.current?.click();
  }, []);

  const handleAvatarFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      if (!file) return;

      if (!ALLOWED_PROFILE_AVATAR_MEDIA_TYPES.includes(file.type as never)) {
        setAvatarDraftError(t("profile.photo.error.unsupported"));
        e.target.value = "";
        return;
      }

      if (file.size > MAX_PROFILE_AVATAR_SIZE_BYTES) {
        setAvatarDraftError(t("profile.photo.error.too_large", { mb: avatarMaxMb }));
        e.target.value = "";
        return;
      }

      setAvatarDraftError(null);
      setAvatarRemoveDraft(false);
      setAvatarDraftFile(file);
      setAvatarPositionDraft({ x: 50, y: 50 });
      setAvatarDraftObjectUrl(URL.createObjectURL(file));
    },
    [avatarMaxMb, t]
  );

  const removeAvatarDraft = useCallback(() => {
    setAvatarDraftError(null);
    setAvatarDraftFile(null);
    setAvatarDraftObjectUrl(null);
    setAvatarPositionDraft({ x: 50, y: 50 });
    setAvatarRemoveDraft(Boolean(activeProfile?.avatar));
    if (avatarFileInputRef.current) {
      avatarFileInputRef.current.value = "";
    }
  }, [activeProfile?.avatar]);

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
          uiLanguage: uiLanguageDraft,
        }),
      });

      const data = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok || !data.profile) {
        throw new Error(data.error || t("error.profile.settings_save_failed"));
      }

      let nextProfile = data.profile;

      const avatarWasRemoved = avatarRemoveDraft && Boolean(activeProfile.avatar);
      const avatarWasUploaded = Boolean(avatarDraftFile);
      const avatarPosWasChanged =
        Boolean(activeProfile.avatar) &&
        !avatarRemoveDraft &&
        !avatarDraftFile &&
        (() => {
          const prev = activeProfile.avatar?.position ?? { x: 50, y: 50 };
          return (
            Math.abs(prev.x - avatarPositionDraft.x) > 0.1 ||
            Math.abs(prev.y - avatarPositionDraft.y) > 0.1
          );
        })();

      if (avatarWasRemoved) {
        const avatarRes = await fetch(`/api/profiles/${activeProfile.id}/avatar`, {
          method: "DELETE",
        });
        const avatarData = (await avatarRes.json().catch(() => null)) as
          | { profile?: Profile; error?: string }
          | null;
        if (!avatarRes.ok || !avatarData?.profile) {
          throw new Error(avatarData?.error || t("error.profile.avatar_save_failed"));
        }
        nextProfile = avatarData.profile;
      } else if (avatarWasUploaded && avatarDraftFile) {
        const form = new FormData();
        form.set("file", avatarDraftFile);
        form.set("posX", String(avatarPositionDraft.x));
        form.set("posY", String(avatarPositionDraft.y));
        const avatarRes = await fetch(`/api/profiles/${activeProfile.id}/avatar`, {
          method: "PUT",
          body: form,
        });
        const avatarData = (await avatarRes.json().catch(() => null)) as
          | { profile?: Profile; error?: string }
          | null;
        if (!avatarRes.ok || !avatarData?.profile) {
          throw new Error(avatarData?.error || t("error.profile.avatar_save_failed"));
        }
        nextProfile = avatarData.profile;
      } else if (avatarPosWasChanged) {
        const avatarRes = await fetch(`/api/profiles/${activeProfile.id}/avatar`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            posX: avatarPositionDraft.x,
            posY: avatarPositionDraft.y,
          }),
        });
        const avatarData = (await avatarRes.json().catch(() => null)) as
          | { profile?: Profile; error?: string }
          | null;
        if (!avatarRes.ok || !avatarData?.profile) {
          throw new Error(avatarData?.error || t("error.profile.avatar_save_failed"));
        }
        nextProfile = avatarData.profile;
      }

      setProfiles((prev) => prev.map((p) => (p.id === nextProfile.id ? nextProfile : p)));
      setUiLanguage(nextProfile.uiLanguage);
      setSettingsOpen(false);
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : t("error.profile.settings_save_failed")
      );
    } finally {
      setSettingsSaving(false);
    }
  }, [
    activeProfile,
    avatarDraftFile,
    avatarPositionDraft.x,
    avatarPositionDraft.y,
    avatarRemoveDraft,
    memoryEnabledDraft,
    profileInstructionsDraft,
    settingsSaving,
    setUiLanguage,
    t,
    uiLanguageDraft,
  ]);

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
        throw new Error(data?.error || t("error.profile.delete_failed"));
      }

      setDeleteProfileOpen(false);
      setSettingsOpen(false);
      await refreshProfiles();
    } catch (err) {
      setDeleteProfileError(
        err instanceof Error ? err.message : t("error.profile.delete_failed")
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
    t,
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
        throw new Error(data.error || t("error.chat.settings_save_failed"));
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
        err instanceof Error
          ? err.message
          : t("error.chat.settings_save_failed")
      );
    } finally {
      setChatSettingsSaving(false);
    }
  }, [
    activeChat?.id,
    activeProfile,
    chatInstructionsDraft,
    chatSettingsChatId,
    chatSettingsSaving,
    refreshChats,
    t,
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
        throw new Error(data.error || t("error.memory.save_failed"));
      }

      setMemoryItems((prev) => [data.item!, ...prev]);
      setMemorizeOpen(false);
    } catch (err) {
      setMemorizeError(
        err instanceof Error ? err.message : t("error.memory.save_failed")
      );
    } finally {
      setMemorizeSaving(false);
    }
  }, [activeProfile, isTemporaryChat, memorizeSaving, memorizeText, t]);

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

  const setDesktopSidebarCollapsedWithComposerFocus = useCallback(
    (collapsed: boolean) => {
      setDesktopSidebarCollapsed(collapsed);
      window.setTimeout(() => focusComposer({ toEnd: true }), 0);
    },
    [focusComposer]
  );

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
	      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar text-sidebar-foreground">
	        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
	          <div className="flex min-w-0 items-center gap-2">
	            <img
	              alt=""
	              aria-hidden="true"
	              className="h-6 w-6 shrink-0"
	              src="/icons/remcochat-sidebar-mark.png"
	            />
	            <div className="min-w-0 truncate font-semibold tracking-tight">RemcoChat</div>
	          </div>
          {mode === "drawer" ? (
            <DialogClose asChild>
              <Button
                aria-label={t("sidebar.close_menu.aria")}
                className="h-9 w-9"
                size="icon"
                type="button"
                variant="outline"
              >
                <XIcon className="size-4" />
              </Button>
            </DialogClose>
          ) : (
            <div className="hidden items-center gap-1 md:flex">
              <Button
                aria-label={t("sidebar.collapse.aria")}
                aria-pressed={!desktopSidebarCollapsed}
                className="h-9 w-9"
                data-testid="sidebar:desktop-toggle"
                onClick={() => setDesktopSidebarCollapsedWithComposerFocus(true)}
                title={t("sidebar.collapse.aria")}
                type="button"
                variant="outline"
              >
                <PanelLeftCloseIcon className="size-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <div className="text-sm font-medium text-muted-foreground">
              {t("sidebar.chats")}
            </div>
            <div className="flex items-center gap-2">
              <Button
                aria-label={t("sidebar.new_folder.aria")}
                className="h-9 w-9 px-0"
                data-testid="sidebar:new-folder"
                disabled={!activeProfile || status !== "ready"}
                onClick={() => setNewFolderOpen(true)}
                title={t("sidebar.new_folder.title")}
                type="button"
                variant="outline"
              >
                <FolderPlusIcon className="size-4" />
              </Button>
              <Button
                aria-label={t("sidebar.new_chat.aria")}
                className="h-9 w-9 px-0"
                data-testid="sidebar:new-chat"
                disabled={!activeProfile || status !== "ready"}
                onClick={() => {
                  createChat();
                  closeIfDrawer();
                }}
                title={t("sidebar.new_chat.title")}
                type="button"
                variant="outline"
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
			                  <span>{t("sidebar.personal_folders")}</span>
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
	                            className="h-9 w-9 shrink-0 px-0 opacity-60 transition-opacity group-hover:opacity-100"
	                            data-testid={`sidebar:folder-menu:${folder.id}`}
	                            disabled={
	                              !activeProfile ||
	                              status !== "ready" ||
	                              folder.profileId !== activeProfile.id
	                            }
	                            suppressHydrationWarning
	                            type="button"
	                            variant="outline"
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
	                            {t("folder.share")}
	                          </DropdownMenuItem>
	                          {(folder.sharedWithCount ?? 0) > 0 ? (
	                            <DropdownMenuItem
	                              data-testid={`folder-action:manage-sharing:${folder.id}`}
	                              onClick={() => openManageFolderSharing(folder.id)}
	                            >
	                              <UsersIcon />
	                              {t("folder.manage_sharing")}
	                            </DropdownMenuItem>
	                          ) : null}
	                          <DropdownMenuSeparator />
	                          <DropdownMenuItem
	                            data-testid={`folder-action:rename:${folder.id}`}
	                            onClick={() => openRenameFolder(folder.id)}
	                          >
	                            <PencilIcon />
                            {t("common.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            data-testid={`folder-action:delete:${folder.id}`}
                            onClick={() => openDeleteFolder(folder.id)}
                            variant="destructive"
                          >
                            <Trash2Icon />
                            {t("folder.delete")}
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
	                                  : "")
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
	                                {chat.title.trim() ? chat.title : t("chat.untitled")}
	                              </div>
	                            </button>

	                            <Button
	                              aria-label={
	                                chatIsPinned(chat)
	                                  ? t("chat.unpin.aria")
	                                  : t("chat.pin.aria")
	                              }
	                              aria-pressed={chatIsPinned(chat)}
	                              className={
	                                "h-9 w-9 shrink-0 px-0 transition-opacity " +
	                                (chatIsPinned(chat)
	                                  ? "opacity-100"
	                                  : "opacity-50 hover:opacity-100 focus-visible:opacity-100")
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
	                                  className="h-9 w-9 shrink-0 px-0 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
                                    {t("chat.move_to_folder")}
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuRadioGroup
                                      onValueChange={(value) => {
                                        moveChatToFolder(chat.id, value || null);
                                      }}
                                      value={chat.folderId ?? ""}
                                    >
	                                      <DropdownMenuRadioItem value="">
	                                        {t("chat.no_folder")}
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
                                  {t("chat.archive")}
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
                                  {t("common.rename")}
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
                                  {t("chat.export.markdown")}
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
                                  {t("chat.export.json")}
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
                                  {t("common.delete")}
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
		                    <span>{t("sidebar.shared_with_me")}</span>
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
		                              <span>
                                {t("sidebar.shared_by", { ownerName })}
                              </span>
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
	                                        : "")
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
	                                        {chat.title.trim() ? chat.title : t("chat.untitled")}
	                                      </div>
	                                    </button>

	                                    <Button
	                                      aria-label={
	                                        chatIsPinned(chat)
	                                          ? t("chat.unpin.aria")
	                                          : t("chat.pin.aria")
	                                      }
	                                      aria-pressed={chatIsPinned(chat)}
	                                      className={
	                                        "h-9 w-9 shrink-0 px-0 transition-opacity " +
	                                        (chatIsPinned(chat)
	                                          ? "opacity-100"
	                                          : "opacity-50 hover:opacity-100 focus-visible:opacity-100")
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
	                                          className="h-9 w-9 shrink-0 px-0 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
                                            {t("chat.move_to_folder")}
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            <DropdownMenuRadioGroup
                                              onValueChange={(value) => {
                                                moveChatToFolder(chat.id, value || null);
                                              }}
                                              value={chat.folderId ?? ""}
                                            >
                                              <DropdownMenuRadioItem value="">
                                                {t("chat.no_folder")}
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
                                          {t("chat.archive")}
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
                                          {t("common.rename")}
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
                                          {t("chat.export.markdown")}
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
                                          {t("chat.export.json")}
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
                                          {t("common.delete")}
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
	                      : "")
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
	                      {chat.title.trim() ? chat.title : t("chat.untitled")}
	                    </div>
	                  </button>

	                  <Button
	                    aria-label={
	                      chatIsPinned(chat) ? t("chat.unpin.aria") : t("chat.pin.aria")
	                    }
	                    aria-pressed={chatIsPinned(chat)}
	                    className={
	                      "h-9 w-9 shrink-0 px-0 transition-opacity " +
	                      (chatIsPinned(chat)
	                        ? "opacity-100"
	                        : "opacity-50 hover:opacity-100 focus-visible:opacity-100")
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
	                        className="h-9 w-9 shrink-0 px-0 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
                          {t("chat.move_to_folder")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuRadioGroup
                            onValueChange={(value) => {
                              moveChatToFolder(chat.id, value || null);
                            }}
                            value={chat.folderId ?? ""}
                          >
	                            <DropdownMenuRadioItem value="">
	                              {t("chat.no_folder")}
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
                        {t("chat.archive")}
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
                        {t("common.rename")}
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
                        {t("chat.export.markdown")}
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
                        {t("chat.export.json")}
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
                        {t("common.delete")}
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
                      {t("sidebar.archived", {
                        count: chats.filter((c) => Boolean(c.archivedAt)).length,
                      })}
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
	                              : "")
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
                              {chat.title.trim() ? chat.title : t("chat.untitled")}
                            </div>
                          </button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
	                              <Button
	                                className="h-9 w-9 shrink-0 px-0 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
                                {t("chat.unarchive")}
                              </DropdownMenuItem>

                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger
                                  data-testid={`chat-action:move-folder:${chat.id}`}
                                >
                                  <FolderIcon />
                                  {t("chat.move_to_folder")}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuRadioGroup
                                    onValueChange={(value) => {
                                      moveChatToFolder(chat.id, value || null);
                                    }}
                                    value={chat.folderId ?? ""}
                                  >
                                    <DropdownMenuRadioItem value="">
                                      {t("chat.no_folder")}
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
                                {t("common.rename")}
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
                                {t("chat.export.markdown")}
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
                                {t("chat.export.json")}
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
                                {t("common.delete")}
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
            {t("sidebar.profile")}
          </div>
          <div className="flex min-w-0 items-center gap-2">
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
                className="h-20 min-w-0 flex-1 data-[size=default]:h-20"
                data-testid="profile:select-trigger"
                suppressHydrationWarning
              >
                <SelectValue
                  className="min-w-0 max-w-full"
                  placeholder={t("profile.select.placeholder")}
                >
                  {activeProfile ? (
                    <div className="flex min-w-0 items-center gap-3">
                      <ProfileAvatar
                        name={activeProfile.name}
                        position={activeProfile.avatar?.position ?? null}
                        sizePx={40}
                        src={getProfileAvatarSrc(activeProfile)}
                      />
                      <span className="min-w-0 truncate">{activeProfile.name}</span>
                    </div>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
	              <SelectContent>
	                {profiles.map((p) => (
	                  <SelectItem
                      className="py-2"
                      data-testid={`profile:option:${p.id}`}
                      key={p.id}
                      value={p.id}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <ProfileAvatar
                          name={p.name}
                          position={p.avatar?.position ?? null}
                          sizePx={28}
                          src={getProfileAvatarSrc(p)}
                        />
                        <span className="min-w-0 truncate">{p.name}</span>
                      </div>
	                  </SelectItem>
	                ))}
	              </SelectContent>
	            </Select>

            <Button
              aria-label={t("profile.new.title")}
              className="h-10 w-10 px-0"
              data-testid="profile:new"
              onClick={() => {
                setCreateOpen(true);
                closeIfDrawer();
              }}
              title={t("profile.new.title")}
              type="button"
              variant="outline"
            >
              <PlusIcon className="size-4" />
            </Button>

            <Button
              aria-label={t("profile.settings.title")}
              className="h-10 w-10 px-0"
              data-testid="profile:settings-open"
              disabled={status !== "ready"}
              onClick={() => {
                setSettingsOpen(true);
                closeIfDrawer();
              }}
              title={t("profile.settings.title")}
              type="button"
              variant="outline"
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

  const resolvedDesktopSidebarWidthPx = clampDesktopSidebarWidth(
    desktopSidebarWidthPx
  );
  const desktopSidebarColumns = desktopSidebarCollapsed
    ? "0px minmax(0, 1fr)"
    : `${resolvedDesktopSidebarWidthPx}px minmax(0, 1fr)`;
  const desktopGridStyle = {
    "--rc-desktop-sidebar-cols": desktopSidebarColumns,
  } as CSSProperties;
  const chatColumnMaxWidthClass = desktopSidebarCollapsed ? "max-w-none" : "max-w-5xl";

  return (
	    <div className="h-dvh w-full overflow-hidden bg-background text-foreground">
	      <div
          className="rc-shell-grid grid h-full min-h-0 grid-cols-1 md:[grid-template-columns:var(--rc-desktop-sidebar-cols)]"
          style={desktopGridStyle}
        >
	        <aside
            aria-hidden={desktopSidebarCollapsed}
            className={
              "rc-desktop-sidebar relative hidden min-h-0 flex-col bg-sidebar text-sidebar-foreground md:flex " +
              (desktopSidebarCollapsed
                ? "overflow-hidden border-r-0"
                : "overflow-visible border-r")
            }
            data-testid="sidebar:desktop"
          >
	          {!desktopSidebarCollapsed ? renderSidebar("desktop") : null}
            {!desktopSidebarCollapsed ? (
              <div
                aria-label={t("sidebar.resize_handle.aria")}
                className={
                  "absolute right-0 top-0 hidden h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none md:block " +
                  (desktopSidebarResizing ? "bg-sidebar-primary/40" : "bg-transparent")
                }
                data-testid="sidebar:desktop-resize-handle"
                onDoubleClick={() =>
                  setDesktopSidebarWidthPx(DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX)
                }
                onPointerCancel={endDesktopSidebarResize}
                onPointerDown={startDesktopSidebarResize}
                onPointerMove={moveDesktopSidebarResize}
                onPointerUp={endDesktopSidebarResize}
                role="separator"
              />
            ) : null}
	        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
	          <header className="border-b">
	            <div className="flex flex-wrap items-center gap-3 pb-3 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
		              <div className="rc-mobile-header flex min-w-0 items-center gap-2 md:hidden">
		                <Button
		                  aria-label={t("sidebar.open_menu.aria")}
	                  onClick={() => setSidebarOpen(true)}
	                  size="icon"
	                  type="button"
	                  variant="outline"
		                >
		                  <MenuIcon className="size-4" />
		                </Button>
		                <div className="flex min-w-0 items-center gap-2">
		                  <img
		                    alt=""
		                    aria-hidden="true"
		                    className="h-5 w-5 shrink-0"
		                    src="/icons/remcochat-sidebar-mark-20.png"
		                  />
		                  <div className="min-w-0 truncate font-semibold tracking-tight">RemcoChat</div>
		                </div>
		              </div>

                {desktopSidebarCollapsed ? (
                  <div className="hidden items-center md:flex">
                    <Button
                      aria-label={t("sidebar.expand.aria")}
                      className="h-9 w-9"
                      data-testid="sidebar:desktop-toggle"
                      onClick={() => setDesktopSidebarCollapsedWithComposerFocus(false)}
                      title={t("sidebar.expand.aria")}
                      type="button"
                      variant="outline"
                    >
                      <PanelLeftOpenIcon className="size-4" />
                    </Button>
                  </div>
                ) : null}

	              <div className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:w-auto">
	                <div className="hidden shrink-0 text-sm text-muted-foreground md:block">
	                  {t("model.label")}
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
                  {lanAdminAccessEnabled ? (
                    <Button
                      aria-label={t("admin_access.title")}
                      className="h-9 w-9 px-0"
                      onClick={() => setLanAdminTokenOpen(true)}
                      title={t("admin_access.title")}
                      type="button"
                      variant="outline"
                    >
	                      <KeyIcon
	                        className={
	                          hasLanAdminToken
	                            ? lanAdminTokenAllowed === false
	                              ? "size-4 text-amber-600 dark:text-amber-400"
	                              : lanAdminTokenAllowed === true
	                                ? "size-4 text-emerald-600 dark:text-emerald-400"
	                                : "size-4 text-muted-foreground"
	                            : "size-4"
	                        }
	                      />
                    </Button>
                  ) : null}
	                <Button
	                  aria-label={
	                    isTemporaryChat
                        ? t("chat.temporary.exit_aria")
                        : t("chat.temporary.enter_aria")
	                  }
	                  className={
	                    "h-9 w-9 px-0 " +
	                    (isTemporaryChat
	                      ? "border-destructive/50 text-destructive bg-destructive/5 hover:bg-destructive/10 focus-visible:border-destructive focus-visible:ring-destructive/30 dark:border-destructive/50 dark:text-destructive dark:bg-destructive/10 dark:hover:bg-destructive/15 dark:focus-visible:border-destructive dark:focus-visible:ring-destructive/40"
	                      : "border-ring/50 text-ring bg-transparent hover:bg-muted hover:text-ring focus-visible:border-ring focus-visible:ring-ring/30 dark:border-ring/50 dark:bg-input/30 dark:hover:bg-input/50 dark:hover:text-ring")
	                  }
	                  data-testid="chat:temporary-toggle"
	                  onClick={() => toggleTemporaryChat()}
	                  title={
                      isTemporaryChat
                        ? t("chat.temporary.title_on")
                        : t("chat.temporary.title_off")
                    }
	                  type="button"
	                  variant="outline"
	                >
	                  {isTemporaryChat ? (
	                    <LockIcon className="size-4" />
	                  ) : (
	                    <LockOpenIcon className="size-4" />
	                  )}
	                </Button>
                  <ThemeToggle />
                  {adminEnabled ? (
                    <Button
                      asChild
                      className="h-9 w-9 px-0"
                      data-testid="admin:open"
                      title={t("admin.dialog.title")}
                      variant="outline"
                    >
                      <Link aria-label={t("admin.open.aria")} href="/admin">
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
            <StickToBottom.Content className="w-full py-4 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:py-6 sm:pl-[max(1.375rem,env(safe-area-inset-left,0px))] sm:pr-[max(1.5rem,env(safe-area-inset-right,0px))] md:py-8 md:pl-[max(1.75rem,env(safe-area-inset-left,0px))] md:pr-[max(2rem,env(safe-area-inset-right,0px))]">
              <div
                className={
                  "mr-auto ml-1 flex w-[calc(100%-0.25rem)] flex-col gap-6 " +
                  chatColumnMaxWidthClass +
                  " sm:ml-2 sm:w-[calc(100%-0.5rem)] md:ml-2.5 md:w-[calc(100%-0.625rem)] lg:ml-3 lg:w-[calc(100%-0.75rem)]"
                }
              >
                {messages.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground">
                    {openingMessage || openingMessageFallback}
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
                    const hasOvNlCard =
                      role === "assistant" &&
                      parts.some(
                        (p) => {
                          if (p.type !== "tool-ovNlGateway") return false;
                          if ((p as { state?: unknown }).state !== "output-available") return false;
                          return shouldSuppressAssistantTextForOvOutput(
                            (p as { output?: unknown }).output
                          );
                        }
                      );
                    const suppressAssistantText =
                      hasMemoryAnswerCard || hasMemoryPromptCard || hasOvNlCard;

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
                                        {t("tool_error.memory", { error: part.errorText })}
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
                                        {t("tool_error.memory", { error: part.errorText })}
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
                                        {t("tool_error.list", { error: part.errorText })}
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
                                        {t("tool_error.lists_overview", {
                                          error: part.errorText,
                                        })}
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
                                        {t("tool_error.agenda", { error: part.errorText })}
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
                                        {t("tool_error.timezones", { error: part.errorText })}
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
	                                        {t("tool_error.current_date_time", {
                                          error: part.errorText,
                                        })}
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
                                        {t("tool_error.url_summary", { error: part.errorText })}
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
                                        {t("tool_error.notes", { error: part.errorText })}
                                      </div>
                                    </div>
                                  );
                                default:
                                  return null;
                              }
                            }

                            if (part.type === "tool-ovNlGateway") {
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
                                    | OvNlToolOutput
                                    | undefined;
                                  if (!output || typeof output !== "object") return null;
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <OvNlCard
                                        output={output}
                                      />
                                    </div>
                                  );
                                }
                                case "output-error":
                                  return (
                                    <div className="space-y-2" key={`${id}-${index}`}>
                                      <ToolCallLine state={part.state} type={part.type} />
                                      <div className="text-sm text-destructive">
                                        {t("tool_error.ov_nl", { error: part.errorText })}
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
                                        {t("tool_error.weather", { error: part.errorText })}
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
                                        {t("tool_error.weather_forecast", {
                                          error: part.errorText,
                                        })}
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
                                    title={t("tool.calling", { toolName })}
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
                              {" "}
                              {t("reasoning.tokens", { count: reasoningTokens })}
                            </div>
                          );
                        })() : null}

	                        {role === "user" ? (
	                          <MessageActions className="justify-end opacity-60 transition-opacity hover:opacity-100 group-hover:opacity-100">
	                            <MessageAction
	                              aria-label={t("message.action.memorize")}
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
                              tooltip={t("message.action.memorize")}
                            >
                              <BookmarkIcon />
                            </MessageAction>
	                            <MessageAction
	                              aria-label={t("message.action.edit")}
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
                              tooltip={t("message.action.edit_fork")}
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
                              {t("common.prev")}
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
                              {t("common.next")}
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
                        <span>{t("reasoning.thinking")}</span>
                      </div>
                    </MessageContent>
                  </Message>
                ) : null}

                {error ? (
                  <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
                    <div>{t("common.something_went_wrong")}</div>
                    <button
                      className="mt-2 underline underline-offset-4"
                      onClick={() => {
                        if (!chatRequestBody) return;
                        scrollTranscriptToBottom("smooth");
                        regenerate({ body: chatRequestBody }).catch(() => {});
                      }}
                      type="button"
                    >
                      {t("common.retry")}
                    </button>
                  </div>
                ) : null}
              </div>
            </StickToBottom.Content>
            <ConversationScrollButton />
          </StickToBottom>

			          <div className="shrink-0 bg-transparent pb-[calc(0.75rem+max(var(--rc-safe-bottom),var(--rc-keyboard-inset)))] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-3 sm:pl-[max(1.375rem,env(safe-area-inset-left,0px))] sm:pr-[max(1.5rem,env(safe-area-inset-right,0px))] md:pb-[calc(1rem+max(var(--rc-safe-bottom),var(--rc-keyboard-inset)))] md:pl-[max(1.75rem,env(safe-area-inset-left,0px))] md:pr-[max(2rem,env(safe-area-inset-right,0px))] md:pt-4">
		            <div
                  className={
                    "mr-auto ml-1 w-[calc(100%-0.25rem)] " +
                    chatColumnMaxWidthClass +
                    " sm:ml-2 sm:w-[calc(100%-0.5rem)] md:ml-2.5 md:w-[calc(100%-0.625rem)] lg:ml-3 lg:w-[calc(100%-0.75rem)]"
                  }
                >
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
                        throw new Error(t("error.chat.missing_chat_id"));
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
                        throw new Error(
                          data?.error || t("error.attachments.upload_failed")
                        );
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
                      err instanceof Error
                        ? err.message
                        : t("error.attachments.upload_failed")
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
                    <Button
                      aria-label={t("composer.regenerate.aria")}
                      className="h-9 w-9 px-0"
                      data-testid="composer:regenerate"
                      onClick={() => regenerateLatest()}
                      title={t("composer.regenerate.aria")}
                      type="button"
                      variant="outline"
                    >
                      <RotateCcwIcon className="size-4" />
                    </Button>
                  ) : null}

                  {(status === "submitted" || status === "streaming") && (
                    <button
                      className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
                      data-testid="composer:stop"
                      onClick={() => stop()}
                      type="button"
                    >
                      {t("common.stop")}
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
                        aria-label={t("composer.attachments.menu.aria")}
                        disabled={status !== "ready"}
                        title={t("composer.attachments.menu.title")}
                      />
                      <PromptInputActionMenuContent>
                        <PromptInputActionAddAttachments />
                      </PromptInputActionMenuContent>
                    </PromptInputActionMenu>

                    {selectedModel?.capabilities?.reasoning &&
                    reasoningOptions.length > 0 ? (
                      <div className="min-w-0 overflow-x-auto">
                        <ButtonGroup aria-label={t("composer.reasoning_level.aria")}>
                          {(
                            [
                              "auto" as const,
                              ...reasoningOptions,
                            ] satisfies ReasoningEffortChoice[]
                          ).map((option) => {
                            const label =
                              option === "auto"
                                ? t("composer.reasoning_level.auto")
                                : option === "minimal"
                                  ? t("composer.reasoning_level.minimal")
                                  : option === "medium"
                                    ? t("composer.reasoning_level.medium")
                                    : option === "high"
                                      ? t("composer.reasoning_level.high")
                                      : t("composer.reasoning_level.low");

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
	                    <Button
	                      aria-label={t("chat.settings.title")}
	                      className="h-9 w-9 px-0"
	                      data-testid="chat:settings-open"
	                      disabled={status !== "ready" || !canManageActiveChat}
	                      onClick={() => openChatSettings()}
	                      title={t("chat.settings.title")}
	                      type="button"
                        variant="outline"
	                    >
                        <SlidersHorizontalIcon className="size-4" />
                      </Button>
                  ) : (
                    <div aria-hidden="true" className="size-9" />
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
	            className="rc-mobile-drawer left-0 top-0 flex h-dvh min-w-0 w-[85vw] max-w-[18rem] flex-col translate-x-0 translate-y-0 gap-0 overflow-x-hidden rounded-none border-0 border-r p-0 data-[state=closed]:slide-out-to-left-2 data-[state=open]:slide-in-from-left-2 md:hidden"
	            data-testid="sidebar:drawer"
	            showCloseButton={false}
	          >
		            <DialogTitle className="sr-only">{t("sidebar.menu.sr_title")}</DialogTitle>
		            {renderSidebar("drawer")}
		          </DialogContent>
	        </Dialog>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("profile.new.title")}</DialogTitle>
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
              placeholder={t("profile.name.placeholder")}
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
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="profile:create-submit"
                disabled={!newProfileName.trim() || creating}
                onClick={() => createProfile()}
                type="button"
              >
                {t("common.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

	      <Dialog onOpenChange={setEditOpen} open={editOpen}>
	        <DialogContent>
	          <DialogHeader>
	            <DialogTitle>{t("chat.edit_fork.title")}</DialogTitle>
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
	                {t("common.cancel")}
	              </Button>
	              <Button
	                disabled={!editText.trim() || editing}
	                data-testid="edit:fork-submit"
	                onClick={() => forkFromEdit()}
	                type="button"
	              >
	                {t("chat.edit_fork.submit")}
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
	            <DialogTitle>{t("profile.settings.title")}</DialogTitle>
	          </DialogHeader>

	          <div className="min-h-0 overflow-y-auto pr-1">
              <div className="space-y-4 pr-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    {t("profile.language.label")}
                  </div>
                  <Select
                    onValueChange={(value) =>
                      setUiLanguageDraft(value as Profile["uiLanguage"])
                    }
                    value={uiLanguageDraft}
                  >
                    <SelectTrigger
                      className="h-9"
                      data-testid="profile:ui-language-trigger"
                      suppressHydrationWarning
                    >
                      <SelectValue />
                    </SelectTrigger>
	                    <SelectContent>
	                      <SelectItem data-testid="profile:ui-language-option:en" value="en">
	                        {t("profile.language.option.en")}
	                      </SelectItem>
	                      <SelectItem data-testid="profile:ui-language-option:nl" value="nl">
	                        {t("profile.language.option.nl")}
	                      </SelectItem>
	                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("profile.photo.label")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("profile.photo.description")}
                  </div>

                  <div className="flex items-center gap-4">
                    <ProfileAvatarPositioner
                      data-testid="profile:avatar-positioner"
                      disabled={settingsSaving || avatarRemoveDraft}
                      name={activeProfile?.name ?? ""}
                      onPositionChange={setAvatarPositionDraft}
                      position={avatarPositionDraft}
                      sizePx={96}
                      src={
                        avatarRemoveDraft
                          ? null
                          : avatarDraftObjectUrl ??
                            (activeProfile ? getProfileAvatarSrc(activeProfile) : null)
                      }
                    />

                    <div className="space-y-2">
                      <input
                        accept={ALLOWED_PROFILE_AVATAR_MEDIA_TYPES.join(",")}
                        className="hidden"
                        onChange={handleAvatarFileChange}
                        ref={avatarFileInputRef}
                        type="file"
                      />

                      <Button
                        className="h-9"
                        disabled={settingsSaving || !activeProfile}
                        onClick={() => chooseAvatarFile()}
                        type="button"
                        variant="outline"
                      >
                        {activeProfile?.avatar || avatarDraftFile
                          ? t("profile.photo.change")
                          : t("profile.photo.upload")}
                      </Button>

                      <Button
                        className="h-9"
                        disabled={settingsSaving || (!activeProfile?.avatar && !avatarDraftFile)}
                        onClick={() => removeAvatarDraft()}
                        type="button"
                        variant="outline"
                      >
                        {t("profile.photo.remove")}
                      </Button>

                      <div className="text-xs text-muted-foreground">
                        {t("profile.photo.max_size", { mb: avatarMaxMb })}
                      </div>
                    </div>
                  </div>

                  {!avatarRemoveDraft &&
                  (avatarDraftObjectUrl || activeProfile?.avatar) ? (
                    <div className="text-xs text-muted-foreground">
                      {t("profile.photo.drag_hint")}
                    </div>
                  ) : null}

                  {avatarDraftError ? (
                    <div className="text-sm text-destructive">{avatarDraftError}</div>
                  ) : null}
                </div>

	              <div className="space-y-2">
	                <div className="text-sm font-medium">
                    {t("profile.custom_instructions.label")}
                  </div>
	                <Textarea
	                  className="min-h-[8rem]"
	                  data-testid="profile:instructions"
	                  onChange={(e) => setProfileInstructionsDraft(e.target.value)}
	                  placeholder={t("profile.custom_instructions.placeholder")}
	                  value={profileInstructionsDraft}
	                />
	              </div>

	            <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
	              <div>
	                <div className="text-sm font-medium">
                    {t("profile.memory.label")}
                  </div>
	                <div className="text-xs text-muted-foreground">
	                  {t("profile.memory.description")}
	                </div>
	              </div>
	              <button
	                aria-checked={memoryEnabledDraft}
	                aria-label={t("profile.memory.toggle.aria")}
	                className={
	                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors " +
	                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
	                  (memoryEnabledDraft ? "bg-primary" : "bg-muted")
	                }
	                data-testid="profile:memory-toggle"
	                onClick={() => setMemoryEnabledDraft((v) => !v)}
	                role="switch"
	                title={
                    memoryEnabledDraft
                      ? t("profile.memory.toggle.title_on")
                      : t("profile.memory.toggle.title_off")
                  }
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
                <div className="text-sm font-medium">
                  {t("profile.memory.saved.title")}
                </div>
                {memoryItems.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {t("profile.memory.saved.empty")}
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
                          {t("common.delete")}
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
              <div className="text-sm font-medium">{t("profile.danger.title")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("profile.danger.description")}
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  data-testid="profile:delete-open"
                  disabled={!activeProfile || status !== "ready"}
                  onClick={() => setDeleteProfileOpen(true)}
                  type="button"
                  variant="destructive"
                >
                  {t("profile.delete.button")}
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
	                  {t("common.cancel")}
	                </Button>
	                <Button
	                  disabled={settingsSaving}
	                  data-testid="profile:settings-save"
	                  onClick={() => saveProfileSettings()}
	                  type="button"
	                >
	                  {t("common.save")}
	                </Button>
	              </div>
	            </div>
	          </div>
	        </DialogContent>
	      </Dialog>

      <Dialog onOpenChange={setDeleteProfileOpen} open={deleteProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("profile.delete.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {t("profile.delete.description", {
                profileName:
                  activeProfile?.name ?? t("profile.delete.fallback_name"),
              })}
            </div>

            <Input
              autoFocus
              data-testid="profile:delete-confirm-input"
              onChange={(e) => setDeleteProfileConfirm(e.target.value)}
              placeholder={t("profile.delete.placeholder")}
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
                {t("common.cancel")}
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
                {t("common.delete")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setChatSettingsOpen} open={chatSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("chat.settings.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {t("chat.settings.note")}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">{t("chat.instructions.label")}</div>
              <Textarea
                className="min-h-[8rem]"
                data-testid="chat:instructions"
                onChange={(e) => setChatInstructionsDraft(e.target.value)}
                placeholder={t("chat.instructions.placeholder")}
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
                {t("common.cancel")}
              </Button>
              <Button
                disabled={chatSettingsSaving}
                data-testid="chat:settings-save"
                onClick={() => saveChatSettings()}
                type="button"
              >
                {t("common.save")}
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
            <DialogTitle>{t("admin_access.title")}</DialogTitle>
          </DialogHeader>

          {!lanAdminAccessEnabled ? (
            <div className="text-sm text-muted-foreground">
              {t("admin_access.not_configured")}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {t("admin_access.description")}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">{t("admin_access.token.label")}</div>
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
                    {lanAdminTokenVisible ? t("common.hide") : t("common.show")}
                  </Button>
                  <Button
	                    onClick={() => {
	                      clearLanAdminToken();
	                      setLanAdminTokenDraft("");
	                      setHasLanAdminToken(false);
	                      setLanAdminTokenAllowed(null);
	                      setLanAdminTokenAllowedReason("");
	                    }}
                    type="button"
                    variant="ghost"
                  >
                    {t("common.clear")}
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-md border bg-card px-3 py-2">
                <button
                  aria-checked={lanAdminTokenRemember}
                  aria-label={t("admin_access.remember.aria")}
                  className={
                    "relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                    (lanAdminTokenRemember ? "bg-primary" : "bg-muted")
                  }
                  onClick={() => setLanAdminTokenRemember((v) => !v)}
                  role="switch"
                  title={
                    lanAdminTokenRemember
                      ? t("admin_access.remember.title_on")
                      : t("admin_access.remember.title_off")
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
                  <div className="text-sm font-medium">{t("admin_access.remember.title")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("admin_access.remember.description")}
                  </div>
                </div>
              </div>

	              <div className="rounded-md border bg-card p-3">
	                <div className="text-sm font-medium">{t("admin_access.verification.title")}</div>
	                <div className="mt-1 text-xs text-muted-foreground">
	                  {t("admin_access.verification.description")}
	                </div>
	                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
	                  <code className="rounded bg-muted px-2 py-1">
	                    x-remcochat-bash-tools-enabled=
	                    {bashToolsEnabledHeader ?? "?"}
	                  </code>
	                  <code className="rounded bg-muted px-2 py-1">
	                    token=
                      {hasLanAdminToken
                        ? t("admin_access.verification.token_present")
                        : t("admin_access.verification.token_absent")}
	                  </code>
	                  <code className="rounded bg-muted px-2 py-1">
	                    admin=
	                    {lanAdminTokenAllowed === true
	                      ? t("admin_access.verification.allowed")
	                      : lanAdminTokenAllowed === false
	                        ? t("admin_access.verification.denied")
	                        : "?"}
	                    {lanAdminTokenAllowedReason ? ` (${lanAdminTokenAllowedReason})` : ""}
	                  </code>
	                </div>
	              </div>

              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setLanAdminTokenOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  {t("common.cancel")}
                </Button>
                <Button
	                  onClick={() => {
	                    writeLanAdminToken(lanAdminTokenDraft, lanAdminTokenRemember);
	                    const token = readLanAdminToken();
	                    setHasLanAdminToken(Boolean(token));
	                    verifyLanAdminToken().catch(() => {});
	                    setLanAdminTokenOpen(false);
	                  }}
                  type="button"
                >
                  {t("admin_access.save_locally")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setRenameChatOpen} open={renameChatOpen}>
        <DialogContent data-testid="chat:rename-dialog">
          <DialogHeader>
            <DialogTitle>{t("chat.rename.title")}</DialogTitle>
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
              placeholder={t("chat.rename.placeholder")}
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
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="chat:rename-save"
                disabled={!canSaveRenameChat}
                onClick={() => renameChatTitle()}
                type="button"
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setNewFolderOpen} open={newFolderOpen}>
        <DialogContent data-testid="folder:new-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.new.title")}</DialogTitle>
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
              placeholder={t("folder.name.placeholder")}
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
                {t("common.cancel")}
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
                {t("common.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setRenameFolderOpen} open={renameFolderOpen}>
        <DialogContent data-testid="folder:rename-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.rename.title")}</DialogTitle>
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
              placeholder={t("folder.name.placeholder")}
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
                {t("common.cancel")}
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
                {t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDeleteFolderOpen} open={deleteFolderOpen}>
        <DialogContent data-testid="folder:delete-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.delete.confirm_title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {t("folder.delete.description")}
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
                {t("common.cancel")}
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
                {t("common.delete")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setShareFolderOpen} open={shareFolderOpen}>
        <DialogContent data-testid="folder:share-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.share.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {t("folder.share.description")}
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
              placeholder={t("folder.share.placeholder")}
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
                {t("common.cancel")}
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
                {t("folder.share")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setManageSharingOpen} open={manageSharingOpen}>
        <DialogContent data-testid="folder:manage-sharing-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.manage_sharing")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {manageSharingFolderName ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                {manageSharingFolderName}
              </div>
            ) : null}

            {manageSharingLoading ? (
              <div className="text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : null}

            {manageSharingError ? (
              <div className="text-sm text-destructive">{manageSharingError}</div>
            ) : null}

            {!manageSharingLoading && manageSharingMembers.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t("folder.manage_sharing.empty")}
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
                      {t("folder.manage_sharing.stop")}
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
                {t("common.close")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setMemorizeOpen} open={memorizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memory.memorize.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Textarea
              autoFocus
              className="min-h-[8rem]"
              onChange={(e) => setMemorizeText(e.target.value)}
              placeholder={t("memory.memorize.placeholder")}
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
                {t("common.cancel")}
              </Button>
              <Button
                disabled={!memorizeText.trim() || memorizeSaving}
                onClick={() => saveMemorize()}
                type="button"
              >
                {t("memory.memorize.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setAdminOpen} open={adminOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.dialog.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">{t("admin.backup.title")}</div>
              <div className="text-sm text-muted-foreground">
                {t("admin.backup.description")}
              </div>
              <div className="flex justify-end">
                <Button
                  data-testid="admin:export"
                  onClick={() => exportAllData()}
                  type="button"
                  variant="secondary"
                >
                  {t("admin.backup.export")}
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-card p-3">
              <div className="text-sm font-medium text-destructive">
                {t("admin.danger.title")}
              </div>
              <div className="text-sm text-muted-foreground">
                {t("admin.danger.description")}
              </div>
              <Input
                autoComplete="off"
                data-testid="admin:reset-confirm"
                onChange={(e) => setAdminResetConfirm(e.target.value)}
                placeholder={t("admin.danger.placeholder")}
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
                  {t("admin.danger.reset")}
                </Button>
              </div>
            </div>

            {adminError ? (
              <div className="text-sm text-destructive">{adminError}</div>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={() => setAdminOpen(false)} type="button" variant="ghost">
                {t("common.close")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
