"use client";

import type { UIMessage } from "ai";
import { nanoid } from "nanoid";
import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { MemoryItem } from "@/domain/memory/types";
import type { Profile } from "@/domain/profiles/types";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";

type MemoryCreateResponse = {
  item?: MemoryItem;
  error?: string;
};

type UseHomeClientTemporaryModeStateInput = {
  initialProfileDefaultModelId: string;
};

type UseHomeClientMemorizeActionsInput = {
  activeProfile: Profile | null;
  addMemoryItem: (item: MemoryItem) => void;
  isTemporaryChat: boolean;
  t: I18nContextValue["t"];
};

export function extractMemorizeTextFromMessage(
  message: UIMessage<RemcoChatMessageMetadata>
): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

export function resolveTemporaryModeModelId(input: {
  isAllowedModel: (modelId: unknown) => modelId is string;
  profileDefaultModelId: string;
  temporaryModelId: string;
}): string {
  return input.isAllowedModel(input.temporaryModelId)
    ? input.temporaryModelId
    : input.profileDefaultModelId;
}

export function createMemoryDecisionMessage(decision: "confirm" | "cancel") {
  return {
    text: decision === "confirm" ? "Confirm memory" : "Cancel memory",
    metadata: { createdAt: new Date().toISOString() },
  };
}

export function useHomeClientTemporaryModeState({
  initialProfileDefaultModelId,
}: UseHomeClientTemporaryModeStateInput) {
  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const [temporarySessionId, setTemporarySessionId] = useState(() => nanoid());
  const [temporaryModelId, setTemporaryModelId] = useState<string>(
    () => initialProfileDefaultModelId
  );

  const toggleTemporaryChat = useCallback((input: {
    currentModelId: string;
    resetCurrentChatState: () => void;
  }) => {
    input.resetCurrentChatState();
    setIsTemporaryChat((previous) => {
      const next = !previous;
      if (next) {
        setTemporarySessionId(nanoid());
        setTemporaryModelId(input.currentModelId);
      }
      return next;
    });
  }, []);

  return {
    active: isTemporaryChat,
    modelId: temporaryModelId,
    sessionId: temporarySessionId,
    setActive: setIsTemporaryChat as Dispatch<SetStateAction<boolean>>,
    setModelId: setTemporaryModelId,
    toggle: toggleTemporaryChat,
  };
}

export function useHomeClientMemorizeActions({
  activeProfile,
  addMemoryItem,
  isTemporaryChat,
  t,
}: UseHomeClientMemorizeActionsInput) {
  const [memorizeOpen, setMemorizeOpen] = useState(false);
  const [memorizeText, setMemorizeText] = useState("");
  const [memorizeSaving, setMemorizeSaving] = useState(false);
  const [memorizeError, setMemorizeError] = useState<string | null>(null);

  const startMemorize = useCallback(
    (message: UIMessage<RemcoChatMessageMetadata>) => {
      if (!activeProfile) return;
      if (isTemporaryChat) return;
      if (!activeProfile.memoryEnabled) return;

      setMemorizeText(extractMemorizeTextFromMessage(message));
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
      const response = await fetch(`/api/profiles/${activeProfile.id}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: memorizeText }),
      });

      const data = (await response.json()) as MemoryCreateResponse;
      if (!response.ok || !data.item) {
        throw new Error(data.error || t("error.memory.save_failed"));
      }

      addMemoryItem(data.item);
      setMemorizeOpen(false);
    } catch (err) {
      setMemorizeError(
        err instanceof Error ? err.message : t("error.memory.save_failed")
      );
    } finally {
      setMemorizeSaving(false);
    }
  }, [activeProfile, addMemoryItem, isTemporaryChat, memorizeSaving, memorizeText, t]);

  return {
    memorize: {
      error: memorizeError,
      open: memorizeOpen,
      saving: memorizeSaving,
      setOpen: setMemorizeOpen,
      setText: setMemorizeText,
      text: memorizeText,
    },
    saveMemorize,
    startMemorize,
  };
}
