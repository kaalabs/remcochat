"use client";

import type {
  Dispatch,
  KeyboardEventHandler,
  SetStateAction,
} from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type UIMessage,
} from "ai";
import { nanoid } from "nanoid";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { I18nContextValue } from "@/components/i18n-provider";
import type {
  AccessibleChat,
  RemcoChatMessageMetadata,
} from "@/domain/chats/types";
import type { TaskListOverview } from "@/domain/lists/types";
import type { Profile } from "@/domain/profiles/types";
import {
  buildLanAdminAuthHeaders,
} from "@/app/lan-admin-token-storage";
import {
  requestFocusComposer,
} from "@/app/home-client-ui-effects";
import {
  createMemoryDecisionMessage,
} from "@/app/home-client-temporary-mode";
import {
  shouldAutoSubmitClientInteraction,
} from "@/lib/chat-auto-submit";
import {
  mergeChatTransportBody,
} from "@/lib/chat-transport";
import {
  extractPromptHistory,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  navigatePromptHistory,
} from "@/lib/composer-history";
import type { ReasoningEffortChoice } from "@/lib/reasoning-effort";

type AttachmentUploadResponse = {
  attachments?: Array<{
    attachmentUrl?: unknown;
    filename?: unknown;
    id?: unknown;
    mediaType?: unknown;
  }>;
  error?: string;
} | null;

type PromptSubmitValue = PromptInputMessage;

type HomeClientUploadedAttachmentPart = {
  type: "file";
  url: string;
  filename?: string;
  mediaType: string;
};

export type HomeClientChatRequestBody =
  | {
      modelId: string;
      profileId: string;
      reasoning?: { effort: ReasoningEffortChoice };
      temporary: true;
      temporarySessionId: string;
    }
  | {
      chatId: string;
      modelId: string;
      profileId: string;
      reasoning?: { effort: ReasoningEffortChoice };
    };

type UseHomeClientChatSessionInput = {
  activeChat: AccessibleChat | null;
  activeProfile: Profile | null;
  effectiveModelId: string;
  instrumentedChatFetch: typeof fetch;
  isTemporaryChat: boolean;
  lanAdminAccessEnabled: boolean;
  queueScrollTranscriptToBottom: (behavior: "instant" | "smooth") => void;
  readLanAdminToken: () => string | null | undefined;
  reasoningEffort: ReasoningEffortChoice;
  reasoningEnabled: boolean;
  scrollTranscriptToBottom: (behavior: "instant" | "smooth") => void;
  setVariantsByUserMessageId: Dispatch<
    SetStateAction<
      Record<string, UIMessage<RemcoChatMessageMetadata>[]>
    >
  >;
  t: I18nContextValue["t"];
  temporarySessionId: string;
};

export function buildHomeClientChatRequestBody(input: {
  activeChatId: string;
  activeProfileId: string;
  effectiveModelId: string;
  isTemporaryChat: boolean;
  reasoningEffort: ReasoningEffortChoice;
  reasoningEnabled: boolean;
  temporarySessionId: string;
}): HomeClientChatRequestBody | null {
  if (!input.activeProfileId) return null;

  const reasoningPayload = input.reasoningEnabled
    ? { reasoning: { effort: input.reasoningEffort } }
    : {};

  if (input.isTemporaryChat) {
    return {
      modelId: input.effectiveModelId,
      profileId: input.activeProfileId,
      temporary: true,
      temporarySessionId: input.temporarySessionId,
      ...reasoningPayload,
    };
  }

  if (!input.activeChatId) return null;

  return {
    chatId: input.activeChatId,
    modelId: input.effectiveModelId,
    profileId: input.activeProfileId,
    ...reasoningPayload,
  };
}

export function buildHomeClientChatTransportHeaders(input: {
  lanAdminAccessEnabled: boolean;
  readLanAdminToken: () => string | null | undefined;
  viewerTimezone?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (input.viewerTimezone) {
    headers["x-remcochat-viewer-timezone"] = input.viewerTimezone;
  }
  if (!input.lanAdminAccessEnabled) return headers;
  return {
    ...headers,
    ...buildLanAdminAuthHeaders(input.readLanAdminToken()),
  };
}

export function shouldShowHomeClientThinking(input: {
  error: unknown;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  status: string;
}): boolean {
  if (input.error != null) return false;
  if (input.status === "submitted") return true;
  if (input.status !== "streaming") return false;

  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i];
    if (!message) continue;
    if (message.role === "assistant") {
      return !message.parts.some(
        (part) => part.type === "text" && part.text.trim()
      );
    }
    if (message.role === "user") {
      return true;
    }
  }

  return true;
}

export function findRegenerateAssistantTarget(
  messages: UIMessage<RemcoChatMessageMetadata>[]
): {
  assistant: UIMessage<RemcoChatMessageMetadata> | null;
  lastUserId: string;
} {
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex < 0) {
    return { assistant: null, lastUserId: "" };
  }

  let lastUserId = "";
  for (let i = lastAssistantIndex; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user") {
      lastUserId = message.id;
      break;
    }
  }

  return {
    assistant: messages[lastAssistantIndex] ?? null,
    lastUserId,
  };
}

export function createRegeneratedAssistantSnapshot(input: {
  assistant: UIMessage<RemcoChatMessageMetadata>;
  createdAt: string;
  id: string;
  turnUserMessageId: string;
}): UIMessage<RemcoChatMessageMetadata> {
  return {
    ...input.assistant,
    id: input.id,
    metadata: {
      ...(input.assistant.metadata ?? {}),
      createdAt: input.createdAt,
      turnUserMessageId: input.turnUserMessageId,
    },
  };
}

export function createOpenListMessage(
  list: TaskListOverview
): {
  metadata: { createdAt: string };
  text: string;
} {
  const ownerSuffix =
    list.scope === "shared" && list.ownerProfileName
      ? ` from ${list.ownerProfileName}`
      : "";

  return {
    metadata: { createdAt: new Date().toISOString() },
    text: `Open list "${list.name}"${ownerSuffix}.`,
  };
}

export function extractPromptAttachmentFiles(
  files: PromptSubmitValue["files"]
): File[] {
  return (
    files
      ?.map((item) => {
        const file = (item as { file?: unknown } | null)?.file;
        return file instanceof File ? file : null;
      })
      .filter((file): file is File => file != null) ?? []
  );
}

export function normalizeUploadedAttachmentParts(
  data: AttachmentUploadResponse
): HomeClientUploadedAttachmentPart[] {
  return (Array.isArray(data?.attachments) ? data.attachments : [])
    .map((attachment) => ({
      type: "file" as const,
      url:
        typeof attachment.attachmentUrl === "string"
          ? attachment.attachmentUrl
          : "",
      mediaType:
        typeof attachment.mediaType === "string" ? attachment.mediaType : "",
      filename:
        typeof attachment.filename === "string"
          ? attachment.filename
          : undefined,
    }))
    .filter((part) => part.url && part.mediaType);
}

async function uploadPromptAttachments(input: {
  activeChatId: string;
  activeProfileId: string;
  files: File[];
  isTemporaryChat: boolean;
  t: I18nContextValue["t"];
  temporarySessionId: string;
}): Promise<HomeClientUploadedAttachmentPart[]> {
  if (input.files.length === 0) return [];

  const form = new FormData();
  form.set("profileId", input.activeProfileId);

  if (input.isTemporaryChat) {
    form.set("temporarySessionId", input.temporarySessionId);
  } else if (input.activeChatId) {
    form.set("chatId", input.activeChatId);
  } else {
    throw new Error(input.t("error.chat.missing_chat_id"));
  }

  for (const file of input.files) {
    form.append("files", file, file.name);
  }

  const response = await fetch("/api/attachments", {
    method: "POST",
    body: form,
  });
  const data = (await response.json().catch(() => null)) as AttachmentUploadResponse;
  if (!response.ok || !Array.isArray(data?.attachments)) {
    throw new Error(data?.error || input.t("error.attachments.upload_failed"));
  }

  return normalizeUploadedAttachmentParts(data);
}

export function useHomeClientChatSession({
  activeChat,
  activeProfile,
  effectiveModelId,
  instrumentedChatFetch,
  isTemporaryChat,
  lanAdminAccessEnabled,
  queueScrollTranscriptToBottom,
  readLanAdminToken,
  reasoningEffort,
  reasoningEnabled,
  scrollTranscriptToBottom,
  setVariantsByUserMessageId,
  t,
  temporarySessionId,
}: UseHomeClientChatSessionInput) {
  const chatSessionKey = isTemporaryChat
    ? `temp:${temporarySessionId}`
    : activeChat?.id || "no-chat";

  const chatRequestBody = useMemo(() => {
    return buildHomeClientChatRequestBody({
      activeChatId: activeChat?.id ?? "",
      activeProfileId: activeProfile?.id ?? "",
      effectiveModelId,
      isTemporaryChat,
      reasoningEffort,
      reasoningEnabled,
      temporarySessionId,
    });
  }, [
    activeChat,
    activeProfile,
    effectiveModelId,
    isTemporaryChat,
    reasoningEffort,
    reasoningEnabled,
    temporarySessionId,
  ]);

  const chatRequestBodyRef = useRef<HomeClientChatRequestBody | null>(null);
  chatRequestBodyRef.current = chatRequestBody;

  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: "/api/chat",
      fetch: instrumentedChatFetch,
      // Approval-triggered resubmits do not carry per-call `body` options, so
      // the transport must supply the current chat context on every request.
      body: () =>
        mergeChatTransportBody(
          chatRequestBodyRef.current as Record<string, unknown> | null,
          undefined
        ),
      headers: () =>
        buildHomeClientChatTransportHeaders({
          lanAdminAccessEnabled,
          readLanAdminToken,
          viewerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
    });
  }, [instrumentedChatFetch, lanAdminAccessEnabled, readLanAdminToken]);

  const {
    addToolApprovalResponse,
    error,
    messages,
    regenerate,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat<UIMessage<RemcoChatMessageMetadata>>({
    id: chatSessionKey,
    transport: chatTransport,
    sendAutomaticallyWhen: shouldAutoSubmitClientInteraction,
  });

  const showThinking = shouldShowHomeClientThinking({
    error,
    messages,
    status,
  });

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
  const [promptHistoryDraft, setPromptHistoryDraft] = useState("");
  const promptHistoryLengthRef = useRef(promptHistory.length);

  useEffect(() => {
    const previousLength = promptHistoryLengthRef.current;
    const nextLength = promptHistory.length;
    promptHistoryLengthRef.current = nextLength;

    setPromptHistoryCursor((cursor) => {
      if (cursor === previousLength || cursor > nextLength) return nextLength;
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
      (event) => {
        if (event.defaultPrevented) return;
        if (event.nativeEvent.isComposing) return;
        if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }

        const element = event.currentTarget;
        const selectionStart = element.selectionStart;
        const selectionEnd = element.selectionEnd;
        if (selectionStart == null || selectionEnd == null) return;
        if (selectionStart !== selectionEnd) return;

        if (event.key === "ArrowUp") {
          if (!isCaretOnFirstLine(element.value, selectionStart)) return;
          const result = navigatePromptHistory({
            direction: "up",
            history: promptHistory,
            cursor: promptHistoryCursor,
            draft: promptHistoryDraft,
            value: element.value,
          });
          if (!result.didNavigate) return;
          event.preventDefault();
          setPromptHistoryCursor(result.cursor);
          setPromptHistoryDraft(result.draft);
          setInput(result.value);
          requestFocusComposer({ toEnd: true });
          return;
        }

        if (event.key === "ArrowDown") {
          if (!isCaretOnLastLine(element.value, selectionStart)) return;
          const result = navigatePromptHistory({
            direction: "down",
            history: promptHistory,
            cursor: promptHistoryCursor,
            draft: promptHistoryDraft,
            value: element.value,
          });
          if (!result.didNavigate) return;
          event.preventDefault();
          setPromptHistoryCursor(result.cursor);
          setPromptHistoryDraft(result.draft);
          setInput(result.value);
          requestFocusComposer({ toEnd: true });
        }
      },
      [
        promptHistory,
        promptHistoryCursor,
        promptHistoryDraft,
      ]
    );

  const regenerateLatest = useCallback(() => {
    if (status !== "ready") return;
    if (!chatRequestBody) return;
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "user") {
      scrollTranscriptToBottom("smooth");
      regenerate().catch(() => {});
      return;
    }

    const { assistant, lastUserId } = findRegenerateAssistantTarget(messages);
    if (!assistant || !lastUserId) return;

    setVariantsByUserMessageId((previous) => {
      const existing = previous[lastUserId] ?? [];
      const snapshot = createRegeneratedAssistantSnapshot({
        assistant,
        createdAt: new Date().toISOString(),
        id: nanoid(),
        turnUserMessageId: lastUserId,
      });
      return { ...previous, [lastUserId]: [...existing, snapshot] };
    });

    scrollTranscriptToBottom("smooth");
    regenerate({
      messageId: assistant.id,
      body: {
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

  const retryLatest = useCallback(() => {
    if (!chatRequestBody) return;
    scrollTranscriptToBottom("smooth");
    regenerate().catch(() => {});
  }, [chatRequestBody, regenerate, scrollTranscriptToBottom]);

  const sendMemoryDecision = useCallback(
    (decision: "confirm" | "cancel") => {
      if (!activeProfile) return;
      if (!chatRequestBody) return;
      if (status !== "ready") return;

      sendMessage(createMemoryDecisionMessage(decision));
    },
    [activeProfile, chatRequestBody, sendMessage, status]
  );

  const sendOpenList = useCallback(
    (list: TaskListOverview) => {
      if (!chatRequestBody) return;
      if (status !== "ready") return;
      sendMessage(createOpenListMessage(list));
    },
    [chatRequestBody, sendMessage, status]
  );

  const handlePromptSubmit = useCallback(
    async ({ files, text }: PromptSubmitValue) => {
      if (!activeProfile) return;
      if (status !== "ready") return;
      if (!chatRequestBody) return;

      setAttachmentUploadError(null);
      setAttachmentUploading(true);

      try {
        const uploadedParts = await uploadPromptAttachments({
          activeChatId: activeChat?.id ?? "",
          activeProfileId: activeProfile.id,
          files: extractPromptAttachmentFiles(files),
          isTemporaryChat,
          t,
          temporarySessionId,
        });

        sendMessage({
          text: String(text ?? ""),
          ...(uploadedParts.length > 0 ? { files: uploadedParts } : {}),
          metadata: { createdAt: new Date().toISOString() },
        }).catch(() => {});
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
    },
    [
      activeChat,
      activeProfile,
      chatRequestBody,
      isTemporaryChat,
      queueScrollTranscriptToBottom,
      sendMessage,
      status,
      t,
      temporarySessionId,
    ]
  );

  const handleAttachmentError = useCallback((message: string) => {
    setAttachmentUploadError(message);
  }, []);

  return {
    addToolApprovalResponse,
    attachmentUploadError,
    canSend,
    chatRequestBody,
    error,
    handleAttachmentCountChange: setComposerAttachmentCount,
    handleAttachmentError,
    handleComposerKeyDown,
    handlePromptSubmit,
    input,
    messages,
    regenerateLatest,
    retryLatest,
    sendMemoryDecision,
    sendOpenList,
    setInput,
    setMessages,
    showThinking,
    status,
    stop,
  };
}
