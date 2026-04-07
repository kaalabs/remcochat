import type { ChatMessage } from "@/server/chat/types";

export function collectPersistedMemoryLines(
  memory: Array<{ content: string }>,
): string[] {
  return memory
    .slice(0, 50)
    .map((item) => item.content.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((item) => `- ${item}`);
}

export function resolvePersistedPromptInstructions(input: {
  profileCustomInstructions?: string | null;
  chatInstructions?: string | null;
}) {
  const storedProfileInstructions = (input.profileCustomInstructions ?? "").trim();
  const resolvedChatInstructions = (input.chatInstructions ?? "").trim();
  const promptProfileInstructions = resolvedChatInstructions
    ? ""
    : storedProfileInstructions;

  return {
    storedProfileInstructions,
    chatInstructions: resolvedChatInstructions,
    promptProfileInstructions,
  };
}

export function preparePersistedPromptContext(input: {
  profileCustomInstructions?: string | null;
  profileInstructionsRevision: number;
  chatInstructions?: string | null;
  chatInstructionsRevision: number;
  memoryEnabled: boolean;
  memory: Array<{ content: string }>;
  activatedSkillNames: string[];
}) {
  const memoryLines = input.memoryEnabled
    ? collectPersistedMemoryLines(input.memory)
    : [];
  const {
    storedProfileInstructions,
    chatInstructions,
    promptProfileInstructions,
  } = resolvePersistedPromptInstructions({
    profileCustomInstructions: input.profileCustomInstructions,
    chatInstructions: input.chatInstructions,
  });

  return {
    memoryLines,
    prompt: {
      isTemporary: false,
      profileInstructions: promptProfileInstructions,
      profileInstructionsRevision: input.profileInstructionsRevision,
      chatInstructions,
      systemChatInstructionsRevision: input.chatInstructionsRevision,
      headerChatInstructionsRevision: input.chatInstructionsRevision,
      storedProfileInstructions,
      memoryEnabled: input.memoryEnabled,
      memoryLines,
      activatedSkillNames: input.activatedSkillNames,
    },
  };
}

export function filterPersistedMessagesForCurrentInstructions(input: {
  messages: ChatMessage[];
  regenerateMessageId?: string | null;
  currentProfileRevision: number;
  currentChatRevision: number;
}) {
  const regenerateMessageId = String(input.regenerateMessageId ?? "");
  return input.messages.filter((message) => {
    if (
      regenerateMessageId &&
      message.role === "assistant" &&
      message.id === regenerateMessageId
    ) {
      return false;
    }
    if (message.role !== "assistant") return true;

    const profileRev = message.metadata?.profileInstructionsRevision;
    const chatRev = message.metadata?.chatInstructionsRevision;

    if (
      typeof profileRev === "number" &&
      profileRev !== input.currentProfileRevision
    ) {
      return false;
    }
    if (
      typeof chatRev === "number" &&
      chatRev !== input.currentChatRevision
    ) {
      return false;
    }

    const missing =
      typeof profileRev !== "number" || typeof chatRev !== "number";
    if (
      missing &&
      (input.currentProfileRevision !== 1 || input.currentChatRevision !== 1)
    ) {
      return false;
    }

    return true;
  });
}

export function buildRegeneratePromptSection(input: {
  isRegenerate: boolean;
  priorAssistantTexts: string[];
}) {
  if (!input.isRegenerate) return "";

  const priorSection =
    input.priorAssistantTexts.length > 0
      ? "Do NOT repeat any of these previous answers (verbatim or near-verbatim):\n" +
        input.priorAssistantTexts
          .map((text, index) => {
            const oneLine = text.replace(/\s+/g, " ").trim();
            const clipped =
              oneLine.length > 240 ? `${oneLine.slice(0, 240)}…` : oneLine;
            return `  ${index + 1}. ${clipped}`;
          })
          .join("\n")
      : "Avoid repeating your previous assistant message verbatim.";

  return [
    "Regeneration: produce an alternative assistant response for the latest user message.",
    priorSection,
    "If higher-priority instructions constrain output, obey them even during regeneration.",
  ].join(" ");
}
