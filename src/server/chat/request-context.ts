import type { ToolBundle } from "@/ai/tool-bundle";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { AgendaActionInput } from "@/server/agenda";
import {
  hash8,
  isValidTimeZone,
  messageText,
  previousUserMessageText,
} from "@/server/chat/helpers";
import type { ChatMessage } from "@/server/chat/types";

export function resolveViewerTimeZone(request: Request): string | undefined {
  const viewerTimeZoneHeader = String(
    request.headers.get("x-remcochat-viewer-timezone") ?? ""
  ).trim();
  return viewerTimeZoneHeader && isValidTimeZone(viewerTimeZoneHeader)
    ? viewerTimeZoneHeader
    : undefined;
}

export function getLastUserTurnContext(messages: ChatMessage[]) {
  const lastUserMessageId = [...messages].reverse().find((message) => message.role === "user")?.id ?? "";
  const lastUserText = lastUserMessageId
    ? messageText([...messages].reverse().find((message) => message.id === lastUserMessageId)!)
    : "";

  return {
    lastUserMessageId,
    lastUserText,
    previousUserText: previousUserMessageText(messages, lastUserMessageId),
  };
}

export function needsViewerTimeZoneForAgenda(
  command: AgendaActionInput,
  viewerTimeZone?: string
) {
  if (viewerTimeZone) return false;

  switch (command.action) {
    case "create":
      return !command.timezone;
    case "list":
      return !command.range.timezone;
    case "update":
      return (
        !command.patch.timezone &&
        Boolean(
          command.match?.date ||
            command.match?.time ||
            command.patch.date ||
            command.patch.time
        )
      );
    case "delete":
    case "share":
    case "unshare":
      return Boolean(command.match?.date || command.match?.time);
    default:
      return true;
  }
}

export function createTurnMessageMetadata(input: {
  createdAt: string;
  turnUserMessageId?: string;
  profileInstructionsRevision?: number;
  chatInstructionsRevision?: number;
}): RemcoChatMessageMetadata {
  const metadata: RemcoChatMessageMetadata = {
    createdAt: input.createdAt,
  };

  if (input.turnUserMessageId) {
    metadata.turnUserMessageId = input.turnUserMessageId;
  }
  if (typeof input.profileInstructionsRevision === "number") {
    metadata.profileInstructionsRevision = input.profileInstructionsRevision;
  }
  if (typeof input.chatInstructionsRevision === "number") {
    metadata.chatInstructionsRevision = input.chatInstructionsRevision;
  }

  return metadata;
}

export function createChatResponseHeaders(input: {
  apiVersion: string;
  temporary: boolean;
  profileId: string;
  chatId?: string;
  extra?: Record<string, string | undefined>;
}) {
  const headers: Record<string, string> = {
    "x-remcochat-api-version": input.apiVersion,
    "x-remcochat-temporary": input.temporary ? "1" : "0",
    "x-remcochat-profile-id": input.profileId,
  };

  if (input.chatId) {
    headers["x-remcochat-chat-id"] = input.chatId;
  }

  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (typeof value === "string") {
      headers[key] = value;
    }
  }

  return headers;
}

function createToolStatusHeaders(prefix: string, bundle: ToolBundle) {
  return {
    [`x-remcochat-${prefix}-enabled`]: bundle.enabled ? "1" : "0",
    [`x-remcochat-${prefix}`]: Object.keys(bundle.tools).join(","),
  };
}

export function createChatRuntimeHeaderExtras(input: {
  resolved: {
    providerId: string;
    modelType: string;
    providerModelId: string;
    modelId: string;
    capabilities: {
      reasoning: boolean;
    };
  };
  reasoning: {
    enabled: boolean;
    exposeToClient: boolean;
    requestedEffort: string;
    effectiveEffort: string;
  };
  profileInstructions: string;
  profileInstructionsRevision: number;
  chatInstructions: string;
  chatInstructionsRevision: number;
  storedProfileInstructions?: string;
  webTools: ToolBundle;
  localAccessTools: ToolBundle;
  bashTools: ToolBundle;
  ovNlTools: ToolBundle;
}) {
  const reasoningEnabled =
    input.reasoning.enabled && input.resolved.capabilities.reasoning;
  const headers: Record<string, string> = {
    "x-remcochat-provider-id": input.resolved.providerId,
    "x-remcochat-model-type": input.resolved.modelType,
    "x-remcochat-provider-model-id": input.resolved.providerModelId,
    "x-remcochat-model-id": input.resolved.modelId,
    "x-remcochat-reasoning-enabled": reasoningEnabled ? "1" : "0",
    "x-remcochat-reasoning-effort": reasoningEnabled
      ? input.reasoning.effectiveEffort
      : "",
    "x-remcochat-reasoning-effort-requested": input.reasoning.requestedEffort,
    "x-remcochat-reasoning-effort-effective": reasoningEnabled
      ? input.reasoning.effectiveEffort
      : "",
    "x-remcochat-reasoning-exposed": input.reasoning.exposeToClient ? "1" : "0",
    "x-remcochat-profile-instructions-rev": String(
      input.profileInstructionsRevision,
    ),
    "x-remcochat-chat-instructions-rev": String(input.chatInstructionsRevision),
    "x-remcochat-profile-instructions-len": String(input.profileInstructions.length),
    "x-remcochat-profile-instructions-hash": hash8(input.profileInstructions),
    "x-remcochat-chat-instructions-len": String(input.chatInstructions.length),
    "x-remcochat-chat-instructions-hash": hash8(input.chatInstructions),
    ...createToolStatusHeaders("web-tools", input.webTools),
    ...createToolStatusHeaders("local-tools", input.localAccessTools),
    ...createToolStatusHeaders("bash-tools", input.bashTools),
    ...createToolStatusHeaders("ov-nl-tools", input.ovNlTools),
  };

  if (typeof input.storedProfileInstructions === "string") {
    headers["x-remcochat-profile-instructions-stored-len"] = String(
      input.storedProfileInstructions.length,
    );
    headers["x-remcochat-profile-instructions-stored-hash"] = hash8(
      input.storedProfileInstructions,
    );
  }

  return headers;
}
