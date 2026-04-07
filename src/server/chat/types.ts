import type { UIMessage } from "ai";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";

type StreamTextParams = Parameters<typeof import("ai").streamText>[0];

export type ChatMessage = UIMessage<RemcoChatMessageMetadata>;
export type StreamTextToolSet = NonNullable<StreamTextParams["tools"]>;
export type StreamTextModel = StreamTextParams["model"];
export type StreamTextMessages = NonNullable<StreamTextParams["messages"]>;
export type StreamTextProviderOptions = StreamTextParams["providerOptions"];

export type ChatRequestBody = {
  messages: ChatMessage[];
  modelId?: string;
  profileId?: string;
  chatId?: string;
  temporary?: boolean;
  temporarySessionId?: string;
  regenerate?: boolean;
  regenerateMessageId?: string;
  reasoning?: {
    effort?: string;
  };
};
