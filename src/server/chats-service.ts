import type {
  AccessibleChat,
  Chat,
  RemcoChatMessageMetadata,
} from "@/domain/chats/types";
import { validateChatTitle } from "@/lib/chat-title";
import type { UIMessage } from "ai";
import { nanoid } from "nanoid";
import { getProfile } from "@/server/profiles";
import { getActiveProviderConfig } from "@/server/model-registry";
import { stripWebToolPartsFromMessages } from "@/server/message-sanitize";
import { deleteAttachmentsForChat } from "@/server/attachments";
import { logEvent } from "@/server/log";
import {
  activatedSkillNamesFromJson,
  clampAssistantTextLimit,
  getCreatedAtFromMessage,
  getTitleFromMessages,
  textFromParts,
  textFromPartsJson,
  updateUserMessageText,
} from "@/server/chats-domain";
import {
  sqliteChatsRepository,
  type ChatsRepository,
  type StoredAccessibleChatRecord,
  type StoredChatRecord,
} from "@/server/chats-repository";

type ChatState = {
  messages: UIMessage<RemcoChatMessageMetadata>[];
  variantsByUserMessageId: Record<string, UIMessage<RemcoChatMessageMetadata>[]>;
};

export type ChatsService = {
  listTurnAssistantTexts(input: {
    chatId: string;
    turnUserMessageId: string;
    limit?: number;
  }): string[];
  listChats(profileId: string): Chat[];
  listAccessibleChats(profileId: string): AccessibleChat[];
  getChat(chatId: string): Chat;
  getChatForViewer(profileId: string, chatId: string): AccessibleChat;
  pinChat(profileId: string, chatId: string): AccessibleChat;
  unpinChat(profileId: string, chatId: string): AccessibleChat;
  recordActivatedSkillName(input: { chatId: string; skillName: string }): string[];
  createChat(input: {
    profileId: string;
    modelId?: string;
    title?: string;
    chatInstructions?: string;
    forkedFromChatId?: string;
    forkedFromMessageId?: string;
  }): Chat;
  updateChat(
    chatId: string,
    patch: Partial<Pick<Chat, "title" | "modelId" | "chatInstructions">>,
  ): Chat;
  updateChatForProfile(
    profileId: string,
    chatId: string,
    patch: Partial<Pick<Chat, "title" | "modelId" | "chatInstructions" | "folderId">>,
  ): Chat;
  archiveChat(profileId: string, chatId: string): Chat;
  unarchiveChat(profileId: string, chatId: string): Chat;
  deleteChat(profileId: string, chatId: string): Promise<void>;
  listChatMessages(chatId: string): UIMessage[];
  loadChatState(chatId: string): ChatState;
  exportChatSnapshot(profileId: string, chatId: string): {
    chat: Chat;
    profile: ReturnType<typeof getProfile>;
    exportedAt: string;
    messages: UIMessage<RemcoChatMessageMetadata>[];
    variantsByUserMessageId: Record<string, UIMessage<RemcoChatMessageMetadata>[]>;
  };
  exportChatMarkdown(profileId: string, chatId: string): {
    markdown: string;
    title: string;
  };
  saveChatState(input: {
    chatId: string;
    profileId: string;
    messages: UIMessage<RemcoChatMessageMetadata>[];
    variantsByUserMessageId?: Record<
      string,
      UIMessage<RemcoChatMessageMetadata>[]
    >;
  }): void;
  forkChatFromUserMessage(input: {
    profileId: string;
    chatId: string;
    userMessageId: string;
    text: string;
  }): Chat;
};

function normalizeModelId(modelId?: string) {
  const { provider } = getActiveProviderConfig();
  const allowed = new Set(provider.allowedModelIds);
  return typeof modelId === "string" && allowed.has(modelId)
    ? modelId
    : provider.defaultModelId;
}

function recordToChat(record: StoredChatRecord): Chat {
  return {
    id: record.id,
    profileId: record.profileId,
    title: record.title,
    modelId: normalizeModelId(record.modelId),
    folderId: record.folderId,
    pinnedAt: record.pinnedAt,
    chatInstructions: record.chatInstructions,
    chatInstructionsRevision: record.chatInstructionsRevision,
    activatedSkillNames: activatedSkillNamesFromJson(record.activatedSkillNamesJson),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
    deletedAt: record.deletedAt,
    forkedFromChatId: record.forkedFromChatId,
    forkedFromMessageId: record.forkedFromMessageId,
  };
}

function recordToAccessibleChat(record: StoredAccessibleChatRecord): AccessibleChat {
  return {
    ...recordToChat(record),
    scope: record.scope,
    ownerName: record.ownerName,
  };
}

export function createChatsService(repository: ChatsRepository): ChatsService {
  function getChat(chatId: string) {
    const record = repository.getChatRecord(chatId);
    if (!record) throw new Error("Chat not found.");
    return recordToChat(record);
  }

  function getChatForViewer(profileId: string, chatId: string) {
    const record = repository.getAccessibleChatRecord(profileId, chatId);
    if (!record) {
      throw new Error("Chat not accessible.");
    }
    return recordToAccessibleChat(record);
  }

  function assertChatWritable(profileId: string, chatId: string): Chat {
    const chat = getChat(chatId);
    if (chat.profileId !== profileId) {
      throw new Error("Chat does not belong to this profile.");
    }
    if (chat.deletedAt) {
      throw new Error("Chat was deleted.");
    }
    return chat;
  }

  function loadChatState(chatId: string): ChatState {
    const messages = repository.listMessageRecords(chatId).map((record) => ({
      id: record.id,
      role: record.role,
      metadata: {
        createdAt: record.createdAt,
        turnUserMessageId: record.turnUserMessageId ?? undefined,
        profileInstructionsRevision:
          typeof record.profileInstructionsRevision === "number"
            ? record.profileInstructionsRevision
            : undefined,
        chatInstructionsRevision:
          typeof record.chatInstructionsRevision === "number"
            ? record.chatInstructionsRevision
            : undefined,
      },
      parts: JSON.parse(record.partsJson) as UIMessage["parts"],
    }));

    const variantsByUserMessageId: Record<
      string,
      UIMessage<RemcoChatMessageMetadata>[]
    > = {};

    for (const record of repository.listVariantRecords(chatId)) {
      const entry = (variantsByUserMessageId[record.turnUserMessageId] ??= []);
      entry.push({
        id: record.id,
        role: record.role,
        metadata: {
          createdAt: record.createdAt,
          turnUserMessageId: record.turnUserMessageId,
        },
        parts: JSON.parse(record.partsJson) as UIMessage["parts"],
      });
    }

    return { messages, variantsByUserMessageId };
  }

  function listTurnAssistantTexts(input: {
    chatId: string;
    turnUserMessageId: string;
    limit?: number;
  }) {
    const limit = clampAssistantTextLimit(input.limit);
    const combined = repository
      .listTurnAssistantMessageRecords({
        chatId: input.chatId,
        turnUserMessageId: input.turnUserMessageId,
        limit,
      })
      .concat(
        repository.listTurnAssistantVariantRecords({
          chatId: input.chatId,
          turnUserMessageId: input.turnUserMessageId,
          limit,
        }),
      )
      .sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );

    const out: string[] = [];
    const seen = new Set<string>();
    for (const record of combined) {
      const text = textFromPartsJson(record.partsJson);
      const normalized = text.replace(/\s+/g, " ").trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(text);
      if (out.length >= limit) break;
    }

    return out;
  }

  function listChats(profileId: string) {
    return repository.listOwnedChatRecords(profileId).map(recordToChat);
  }

  function listAccessibleChats(profileId: string) {
    return repository.listAccessibleChatRecords(profileId).map(recordToAccessibleChat);
  }

  function pinChat(profileId: string, chatId: string) {
    getChatForViewer(profileId, chatId);
    repository.upsertChatPin(profileId, chatId, new Date().toISOString());
    return getChatForViewer(profileId, chatId);
  }

  function unpinChat(profileId: string, chatId: string) {
    getChatForViewer(profileId, chatId);
    repository.deleteChatPin(profileId, chatId);
    return getChatForViewer(profileId, chatId);
  }

  function recordActivatedSkillName(input: { chatId: string; skillName: string }) {
    const chatId = String(input.chatId ?? "").trim();
    if (!chatId) throw new Error("Missing chat id.");

    const skillName = String(input.skillName ?? "").trim();
    if (!skillName) throw new Error("Missing skill name.");

    const activatedSkillNamesJson = repository.getActivatedSkillNamesJson(chatId);
    if (activatedSkillNamesJson == null) throw new Error("Chat not found.");

    const existing = activatedSkillNamesFromJson(activatedSkillNamesJson);
    if (existing.includes(skillName)) return existing;

    const next = existing.concat(skillName);
    repository.updateActivatedSkillNames(
      chatId,
      JSON.stringify(next),
      new Date().toISOString(),
    );

    try {
      logEvent("info", "skills.activated", {
        chatId,
        skillName,
        activatedSkillNamesCount: next.length,
      });
    } catch {
      // ignore
    }

    return next;
  }

  function createChat(input: {
    profileId: string;
    modelId?: string;
    title?: string;
    chatInstructions?: string;
    forkedFromChatId?: string;
    forkedFromMessageId?: string;
  }) {
    const profile = getProfile(input.profileId);
    const now = new Date().toISOString();
    const record = repository.createChatRecord({
      id: nanoid(),
      profileId: profile.id,
      title: (input.title ?? "").trim(),
      modelId: normalizeModelId(input.modelId),
      chatInstructions: String(input.chatInstructions ?? ""),
      createdAt: now,
      updatedAt: now,
      forkedFromChatId: input.forkedFromChatId ?? null,
      forkedFromMessageId: input.forkedFromMessageId ?? null,
    });
    return recordToChat(record);
  }

  function updateChat(
    chatId: string,
    patch: Partial<Pick<Chat, "title" | "modelId" | "chatInstructions">>,
  ) {
    const current = getChat(chatId);
    const title =
      patch.title != null
        ? (() => {
            const next = validateChatTitle(String(patch.title));
            if (!next.ok) throw new Error(next.error);
            return next.title;
          })()
        : current.title;
    const modelId =
      patch.modelId != null ? normalizeModelId(patch.modelId) : current.modelId;
    const chatInstructions =
      patch.chatInstructions != null
        ? String(patch.chatInstructions)
        : current.chatInstructions;
    const chatInstructionsRevision =
      patch.chatInstructions != null && chatInstructions !== current.chatInstructions
        ? current.chatInstructionsRevision + 1
        : current.chatInstructionsRevision;

    repository.updateChatCore({
      chatId,
      title,
      modelId,
      chatInstructions,
      chatInstructionsRevision,
      updatedAt: new Date().toISOString(),
    });

    return getChat(chatId);
  }

  function updateChatForProfile(
    profileId: string,
    chatId: string,
    patch: Partial<Pick<Chat, "title" | "modelId" | "chatInstructions" | "folderId">>,
  ) {
    assertChatWritable(profileId, chatId);

    if (patch.folderId !== undefined) {
      if (patch.folderId !== null && !repository.folderExistsForOwner(profileId, patch.folderId)) {
        throw new Error("Folder not found.");
      }
      repository.updateChatFolder(profileId, chatId, patch.folderId);
    }

    const remainingPatch = {
      title: patch.title,
      modelId: patch.modelId,
      chatInstructions: patch.chatInstructions,
    } satisfies Partial<Pick<Chat, "title" | "modelId" | "chatInstructions">>;

    if (
      remainingPatch.title !== undefined ||
      remainingPatch.modelId !== undefined ||
      remainingPatch.chatInstructions !== undefined
    ) {
      return updateChat(chatId, remainingPatch);
    }

    return getChat(chatId);
  }

  function archiveChat(profileId: string, chatId: string) {
    const current = assertChatWritable(profileId, chatId);
    if (current.archivedAt) return current;
    repository.updateChatArchiveState(chatId, new Date().toISOString(), new Date().toISOString());
    return getChat(chatId);
  }

  function unarchiveChat(profileId: string, chatId: string) {
    const current = assertChatWritable(profileId, chatId);
    if (!current.archivedAt) return current;
    repository.updateChatArchiveState(chatId, null, new Date().toISOString());
    return getChat(chatId);
  }

  async function deleteChat(profileId: string, chatId: string) {
    assertChatWritable(profileId, chatId);
    await deleteAttachmentsForChat({ profileId, chatId });
    const now = new Date().toISOString();
    repository.updateChatDeletedState(chatId, now, now);
  }

  function listChatMessages(chatId: string) {
    return repository.listMessageRecords(chatId).map((record) => ({
      id: record.id,
      role: record.role,
      parts: JSON.parse(record.partsJson) as UIMessage["parts"],
    }));
  }

  function exportChatSnapshot(profileId: string, chatId: string) {
    const chat = assertChatWritable(profileId, chatId);
    const profile = getProfile(profileId);
    const { messages, variantsByUserMessageId } = loadChatState(chat.id);
    return {
      chat,
      profile,
      exportedAt: new Date().toISOString(),
      messages,
      variantsByUserMessageId,
    };
  }

  function exportChatMarkdown(profileId: string, chatId: string) {
    const snapshot = exportChatSnapshot(profileId, chatId);
    const title = snapshot.chat.title.trim() ? snapshot.chat.title.trim() : "New chat";
    const lines: string[] = [];

    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`- Exported: ${snapshot.exportedAt}`);
    lines.push(`- Profile: ${snapshot.profile.name}`);
    lines.push(`- Model: ${snapshot.chat.modelId}`);
    lines.push(`- Chat ID: ${snapshot.chat.id}`);
    if (snapshot.chat.forkedFromChatId && snapshot.chat.forkedFromMessageId) {
      lines.push(
        `- Forked from: ${snapshot.chat.forkedFromChatId} @ ${snapshot.chat.forkedFromMessageId}`,
      );
    }
    lines.push("");
    lines.push("## Instructions");
    lines.push("");
    lines.push("### Profile");
    lines.push("");
    lines.push("```text");
    lines.push((snapshot.profile.customInstructions ?? "").trim());
    lines.push("```");
    lines.push("");
    lines.push("### Chat");
    lines.push("");
    lines.push("```text");
    lines.push((snapshot.chat.chatInstructions ?? "").trim());
    lines.push("```");
    lines.push("");
    lines.push("## Conversation");
    lines.push("");

    for (const message of snapshot.messages) {
      const role =
        message.role === "user"
          ? "User"
          : message.role === "assistant"
            ? "Assistant"
            : "System";
      lines.push(`### ${role}`);
      lines.push("");
      lines.push(textFromParts(message.parts) || "_(empty)_");
      lines.push("");
    }

    const variantEntries = Object.entries(snapshot.variantsByUserMessageId).filter(
      ([, variants]) => variants.length > 0,
    );
    if (variantEntries.length > 0) {
      lines.push("## Variants (Unselected)");
      lines.push("");
      for (const [turnUserMessageId, variants] of variantEntries) {
        lines.push(`### Turn ${turnUserMessageId}`);
        lines.push("");
        for (const variant of variants) {
          lines.push(`- ${variant.metadata?.createdAt ?? "unknown"}:`);
          lines.push("");
          lines.push("```text");
          lines.push(textFromParts(variant.parts));
          lines.push("```");
          lines.push("");
        }
      }
    }

    return { markdown: lines.join("\n"), title };
  }

  function saveChatState(input: {
    chatId: string;
    profileId: string;
    messages: UIMessage<RemcoChatMessageMetadata>[];
    variantsByUserMessageId?: Record<
      string,
      UIMessage<RemcoChatMessageMetadata>[]
    >;
  }) {
    const chat = getChatForViewer(input.profileId, input.chatId);
    const now = new Date().toISOString();
    const messages = stripWebToolPartsFromMessages(input.messages);
    const variantsByUserMessageId = Object.fromEntries(
      Object.entries(input.variantsByUserMessageId ?? {}).map(([turnId, variants]) => [
        turnId,
        stripWebToolPartsFromMessages(variants),
      ]),
    );

    let lastUserMessageId: string | null = null;
    const persistedMessages = messages.map((message, position) => {
      const turnUserMessageId =
        message.role === "assistant" ? lastUserMessageId : null;
      if (message.role === "user") {
        lastUserMessageId = message.id;
      }
      return {
        id: message.id,
        role: message.role,
        partsJson: JSON.stringify(message.parts),
        createdAt: getCreatedAtFromMessage(message, now),
        position,
        turnUserMessageId,
        profileInstructionsRevision:
          typeof message.metadata?.profileInstructionsRevision === "number"
            ? message.metadata.profileInstructionsRevision
            : null,
        chatInstructionsRevision:
          typeof message.metadata?.chatInstructionsRevision === "number"
            ? message.metadata.chatInstructionsRevision
            : null,
      };
    });

    const persistedVariants = Object.entries(variantsByUserMessageId).flatMap(
      ([turnUserMessageId, variants]) =>
        variants.flatMap((variant) =>
          variant.role === "assistant"
            ? [
                {
                  id: variant.id,
                  role: "assistant" as const,
                  partsJson: JSON.stringify(variant.parts),
                  createdAt: getCreatedAtFromMessage(variant, now),
                  turnUserMessageId,
                },
              ]
            : [],
        ),
    );

    repository.replaceChatState({
      chatId: chat.id,
      messages: persistedMessages,
      variants: persistedVariants,
      updatedAt: now,
      inferredTitle: chat.title.trim() ? "" : getTitleFromMessages(messages as UIMessage[]),
    });
  }

  function forkChatFromUserMessage(input: {
    profileId: string;
    chatId: string;
    userMessageId: string;
    text: string;
  }) {
    const originalChat = getChat(input.chatId);
    if (originalChat.profileId !== input.profileId) {
      throw new Error("Chat does not belong to this profile.");
    }

    const { messages, variantsByUserMessageId } = loadChatState(originalChat.id);
    const index = messages.findIndex((message) => message.id === input.userMessageId);
    if (index === -1) throw new Error("Message not found.");

    const target = messages[index];
    if (!target || target.role !== "user") {
      throw new Error("Only user messages can be edited.");
    }

    const forkMessages = messages.slice(0, index + 1);
    forkMessages[index] = updateUserMessageText(target, input.text);

    const allowedUserIds = new Set(
      forkMessages.filter((message) => message.role === "user").map((message) => message.id),
    );

    const forkVariants: Record<
      string,
      UIMessage<RemcoChatMessageMetadata>[]
    > = {};

    for (const [userMessageId, variants] of Object.entries(variantsByUserMessageId)) {
      if (!allowedUserIds.has(userMessageId)) continue;
      forkVariants[userMessageId] = variants;
    }

    const sourceTurnAssistantMessages: UIMessage<RemcoChatMessageMetadata>[] = [];
    for (let i = index + 1; i < messages.length; i++) {
      const message = messages[i];
      if (!message) continue;
      if (message.role !== "assistant") break;
      sourceTurnAssistantMessages.push({
        ...message,
        metadata: {
          ...(message.metadata ?? {}),
          turnUserMessageId: input.userMessageId,
        },
      });
    }

    const existing = forkVariants[input.userMessageId] ?? [];
    if (existing.length > 0 || sourceTurnAssistantMessages.length > 0) {
      const byId = new Map<string, UIMessage<RemcoChatMessageMetadata>>();
      for (const variant of existing) {
        if (variant.role !== "assistant") continue;
        byId.set(variant.id, variant);
      }
      for (const variant of sourceTurnAssistantMessages) {
        if (variant.role !== "assistant") continue;
        byId.set(variant.id, variant);
      }
      forkVariants[input.userMessageId] = Array.from(byId.values());
    }

    const fork = createChat({
      profileId: originalChat.profileId,
      modelId: originalChat.modelId,
      title: "",
      chatInstructions: originalChat.chatInstructions,
      forkedFromChatId: originalChat.id,
      forkedFromMessageId: input.userMessageId,
    });

    saveChatState({
      chatId: fork.id,
      profileId: fork.profileId,
      messages: forkMessages,
      variantsByUserMessageId: forkVariants,
    });

    return getChat(fork.id);
  }

  return {
    listTurnAssistantTexts,
    listChats,
    listAccessibleChats,
    getChat,
    getChatForViewer,
    pinChat,
    unpinChat,
    recordActivatedSkillName,
    createChat,
    updateChat,
    updateChatForProfile,
    archiveChat,
    unarchiveChat,
    deleteChat,
    listChatMessages,
    loadChatState,
    exportChatSnapshot,
    exportChatMarkdown,
    saveChatState,
    forkChatFromUserMessage,
  };
}

export const chatsService = createChatsService(sqliteChatsRepository);
