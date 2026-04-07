import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { UIMessage } from "ai";

export function textFromPartsJson(partsJson: string) {
  try {
    const parts = JSON.parse(partsJson) as UIMessage["parts"];
    return parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

export function textFromParts(parts: UIMessage["parts"]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

export function activatedSkillNamesFromJson(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      const name = String(entry ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

export function clampAssistantTextLimit(limit?: number) {
  return Math.max(1, Math.min(20, Math.floor(limit ?? 8)));
}

export function getTitleFromMessages(messages: UIMessage[]) {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return "";
  const firstText = firstUser.parts.find((part) => part.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  if (!firstText?.text) return "";
  const title = firstText.text.trim().replace(/\s+/g, " ");
  return title.length > 60 ? `${title.slice(0, 60)}…` : title;
}

export function getCreatedAtFromMessage(
  message: UIMessage<RemcoChatMessageMetadata>,
  fallback: string,
) {
  const createdAt = message.metadata?.createdAt;
  if (typeof createdAt !== "string") return fallback;
  if (!Number.isFinite(Date.parse(createdAt))) return fallback;
  return createdAt;
}

export function updateUserMessageText(
  message: UIMessage<RemcoChatMessageMetadata>,
  text: string,
): UIMessage<RemcoChatMessageMetadata> {
  const nextText = text.trim();
  if (!nextText) throw new Error("Message text cannot be empty.");

  const parts = [...message.parts];
  let hasText = false;
  const nextParts = parts
    .map((part) => {
      if (part.type !== "text") return part;
      if (hasText) return null;
      hasText = true;
      return { ...part, text: nextText };
    })
    .filter(Boolean) as UIMessage<RemcoChatMessageMetadata>["parts"];

  if (!hasText) {
    nextParts.unshift({ type: "text", text: nextText });
  }

  return {
    ...message,
    parts: nextParts,
    metadata: { ...(message.metadata ?? {}), createdAt: new Date().toISOString() },
  };
}
