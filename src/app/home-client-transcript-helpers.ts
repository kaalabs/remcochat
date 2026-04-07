"use client";

import { type UIMessage } from "ai";

import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import {
  shouldSuppressAssistantTextForOvOutput,
} from "@/lib/ov-nl-recovery";

export type HomeClientTranscriptMessage = UIMessage<RemcoChatMessageMetadata> & {
  inferredTurnUserMessageId: string | null;
};

export type HomeClientTranscriptVariantsByUserMessageId = Record<
  string,
  UIMessage<RemcoChatMessageMetadata>[]
>;

export function buildHomeClientTranscriptMessages(
  messages: UIMessage<RemcoChatMessageMetadata>[]
): HomeClientTranscriptMessage[] {
  return messages.reduce<{
    items: HomeClientTranscriptMessage[];
    lastUserMessageId: string | null;
  }>(
    (acc, message) => {
      const lastUserMessageId =
        message.role === "user" ? message.id : acc.lastUserMessageId;

      return {
        lastUserMessageId,
        items: [
          ...acc.items,
          {
            ...message,
            inferredTurnUserMessageId:
              message.role === "assistant"
                ? message.metadata?.turnUserMessageId ?? lastUserMessageId
                : lastUserMessageId,
          },
        ],
      };
    },
    { items: [], lastUserMessageId: null }
  ).items;
}

export function shouldSuppressTranscriptAssistantText(
  parts: UIMessage<RemcoChatMessageMetadata>["parts"]
): boolean {
  const hasMemoryAnswerCard = parts.some(
    (part) => part.type === "tool-displayMemoryAnswer"
  );
  const hasMemoryPromptCard = parts.some(
    (part) => part.type === "tool-displayMemoryPrompt"
  );
  const hasOvNlCard = parts.some((part) => {
    if (part.type !== "tool-ovNlGateway") return false;
    if ((part as { state?: unknown }).state !== "output-available") return false;
    return shouldSuppressAssistantTextForOvOutput(
      (part as { output?: unknown }).output
    );
  });

  return hasMemoryAnswerCard || hasMemoryPromptCard || hasOvNlCard;
}

export function sortHomeClientAssistantVariants(
  currentMessage: UIMessage<RemcoChatMessageMetadata>,
  variants: UIMessage<RemcoChatMessageMetadata>[]
): UIMessage<RemcoChatMessageMetadata>[] {
  return [currentMessage, ...variants].sort((a, b) => {
    const aAt = a.metadata?.createdAt ?? "";
    const bAt = b.metadata?.createdAt ?? "";
    if (aAt < bAt) return -1;
    if (aAt > bAt) return 1;
    return a.id.localeCompare(b.id);
  });
}

export function swapHomeClientAssistantVariant(input: {
  currentMessage: UIMessage<RemcoChatMessageMetadata>;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  targetId: string;
  turnUserMessageId: string;
  variantsByUserMessageId: HomeClientTranscriptVariantsByUserMessageId;
}): {
  messages: UIMessage<RemcoChatMessageMetadata>[];
  variantsByUserMessageId: HomeClientTranscriptVariantsByUserMessageId;
} {
  const currentVariants =
    input.variantsByUserMessageId[input.turnUserMessageId] ?? [];
  const target = currentVariants.find((message) => message.id === input.targetId);
  if (!target) {
    return {
      messages: input.messages,
      variantsByUserMessageId: input.variantsByUserMessageId,
    };
  }

  return {
    messages: input.messages.map((message) =>
      message.id === input.currentMessage.id ? target : message
    ),
    variantsByUserMessageId: {
      ...input.variantsByUserMessageId,
      [input.turnUserMessageId]: currentVariants
        .filter((message) => message.id !== input.targetId)
        .concat([input.currentMessage]),
    },
  };
}
