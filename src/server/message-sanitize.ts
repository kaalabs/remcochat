import type { UIMessage } from "ai";
import type { RemcoChatMessageMetadata } from "@/lib/types";

const WEB_TOOL_NAMES = new Set([
  "perplexity_search",
  "web_search",
  "web_fetch",
  "google_search",
  "url_context",
]);

function toolNameFromPart(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  if (!("type" in part)) return null;
  const type = (part as { type?: unknown }).type;
  if (typeof type !== "string") return null;

  if (type === "tool-call" || type === "tool-result") {
    const toolName = (part as { toolName?: unknown }).toolName;
    return typeof toolName === "string" ? toolName : null;
  }

  if (type.startsWith("tool-")) {
    const inferred = type.slice("tool-".length);
    return inferred ? inferred : null;
  }

  return null;
}

function isWebToolPart(part: unknown): boolean {
  const name = toolNameFromPart(part);
  return Boolean(name && WEB_TOOL_NAMES.has(name));
}

export function stripWebToolPartsFromMessages(
  messages: UIMessage<RemcoChatMessageMetadata>[]
): UIMessage<RemcoChatMessageMetadata>[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => !isWebToolPart(part)),
  }));
}
