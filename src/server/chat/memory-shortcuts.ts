import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import { createMemoryItem } from "@/server/memory-service";
import {
  clearPendingMemory,
  type PendingMemory,
  upsertPendingMemory,
} from "@/server/pending-memory";
import { parseMemoryAddCommand } from "@/server/memory-commands";
import {
  needsMemoryContext,
  previousUserMessageText,
} from "@/server/chat/helpers";
import {
  uiMemoryPromptResponse,
  uiMemoryAnswerResponse,
  uiTextResponse,
} from "@/server/chat/presenters";
import type { ChatMessage } from "@/server/chat/types";

export function maybeCreatePersistedMemoryPromptResponse(input: {
  candidate: string | null | undefined;
  chatId: string;
  profile: {
    id: string;
    memoryEnabled: boolean;
  };
  messageMetadata: RemcoChatMessageMetadata;
  headers: HeadersInit;
}): Response | null {
  const candidate = String(input.candidate ?? "").trim();
  if (!candidate) return null;

  if (!input.profile.memoryEnabled) {
    return uiTextResponse({
      text: "Memory is currently off for this profile. Enable it in Profile Settings, then try again.",
      messageMetadata: input.messageMetadata,
    });
  }

  if (needsMemoryContext(candidate)) {
    return uiTextResponse({
      text:
        "I need a bit more context to store this memory. Please add a short sentence (who/what/why) so it will be useful later.",
      messageMetadata: input.messageMetadata,
    });
  }

  try {
    const pending = upsertPendingMemory({
      chatId: input.chatId,
      profileId: input.profile.id,
      content: candidate,
    });
    return uiMemoryPromptResponse({
      content: pending.content,
      messageMetadata: input.messageMetadata,
      headers: input.headers,
    });
  } catch (err) {
    return uiTextResponse({
      text:
        err instanceof Error
          ? err.message
          : "Failed to prepare memory confirmation.",
      messageMetadata: input.messageMetadata,
    });
  }
}

export function handleMemorizeDecision(input: {
  pendingMemory: PendingMemory | null;
  memorizeDecision: "confirm" | "cancel" | null;
  messages: ChatMessage[];
  lastUserMessageId: string;
  chatId: string;
  profile: {
    id: string;
    memoryEnabled: boolean;
  };
  messageMetadata: RemcoChatMessageMetadata;
  headers: HeadersInit;
}): Response | null {
  if (!input.memorizeDecision) return null;

  if (input.pendingMemory) {
    if (input.memorizeDecision === "cancel") {
      clearPendingMemory(input.chatId);
      return uiTextResponse({
        text: "Okay, I won't save that.",
        messageMetadata: input.messageMetadata,
      });
    }

    if (!input.profile.memoryEnabled) {
      clearPendingMemory(input.chatId);
      return uiTextResponse({
        text: "Memory is currently off for this profile. Enable it in Profile Settings, then try again.",
        messageMetadata: input.messageMetadata,
      });
    }

    try {
      createMemoryItem({
        profileId: input.profile.id,
        content: input.pendingMemory.content,
      });
      clearPendingMemory(input.chatId);
      return uiMemoryAnswerResponse({
        answer: "Saved to memory.",
        messageMetadata: input.messageMetadata,
        headers: input.headers,
      });
    } catch (err) {
      clearPendingMemory(input.chatId);
      return uiTextResponse({
        text: err instanceof Error ? err.message : "Failed to save memory item.",
        messageMetadata: input.messageMetadata,
      });
    }
  }

  const previousCandidate = parseMemoryAddCommand(
    previousUserMessageText(input.messages, input.lastUserMessageId)
  );
  if (previousCandidate) {
    if (input.memorizeDecision === "cancel") {
      return uiTextResponse({
        text: "Okay, I won't save that.",
        messageMetadata: input.messageMetadata,
      });
    }

    if (!input.profile.memoryEnabled) {
      return uiTextResponse({
        text: "Memory is currently off for this profile. Enable it in Profile Settings, then try again.",
        messageMetadata: input.messageMetadata,
      });
    }

    if (needsMemoryContext(previousCandidate)) {
      return uiTextResponse({
        text:
          "I need a bit more context to store this memory. Please restate it as a short sentence (who/what/why), then ask me to remember it again.",
        messageMetadata: input.messageMetadata,
      });
    }

    try {
      createMemoryItem({
        profileId: input.profile.id,
        content: previousCandidate,
      });
      return uiMemoryAnswerResponse({
        answer: "Saved to memory.",
        messageMetadata: input.messageMetadata,
        headers: input.headers,
      });
    } catch (err) {
      return uiTextResponse({
        text: err instanceof Error ? err.message : "Failed to save memory item.",
        messageMetadata: input.messageMetadata,
      });
    }
  }

  return uiTextResponse({
    text: "I don't have anything pending to confirm. Ask me to remember something first, then confirm when prompted.",
    messageMetadata: input.messageMetadata,
  });
}
