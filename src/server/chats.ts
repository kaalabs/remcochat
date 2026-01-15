import type { Chat, RemcoChatMessageMetadata } from "@/lib/types";
import type { UIMessage } from "ai";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { getProfile } from "./profiles";
import { getActiveProviderConfig } from "@/server/model-registry";

type ChatRow = {
  id: string;
  profile_id: string;
  title: string;
  model_id: string;
  chat_instructions: string;
  chat_instructions_revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  forked_from_chat_id: string | null;
  forked_from_message_id: string | null;
};

type MessageRow = {
  id: string;
  role: "system" | "user" | "assistant";
  parts_json: string;
  created_at: string;
  turn_user_message_id: string | null;
  profile_instructions_revision: number | null;
  chat_instructions_revision: number | null;
};

type VariantRow = {
  id: string;
  role: "assistant";
  parts_json: string;
  created_at: string;
  turn_user_message_id: string;
};

function textFromPartsJson(partsJson: string) {
  try {
    const parts = JSON.parse(partsJson) as UIMessage["parts"];
    return parts
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

function textFromParts(parts: UIMessage["parts"]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

export function listTurnAssistantTexts(input: {
  chatId: string;
  turnUserMessageId: string;
  limit?: number;
}): string[] {
  const db = getDb();
  const limit = Math.max(1, Math.min(20, Math.floor(input.limit ?? 8)));

  const selectedRows = db
    .prepare(
      `SELECT parts_json, created_at
       FROM messages
       WHERE chat_id = ? AND role = 'assistant' AND turn_user_message_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(input.chatId, input.turnUserMessageId, limit) as Array<{
    parts_json: string;
    created_at: string;
  }>;

  const variantRows = db
    .prepare(
      `SELECT parts_json, created_at
       FROM message_variants
       WHERE chat_id = ? AND turn_user_message_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(input.chatId, input.turnUserMessageId, limit) as Array<{
    parts_json: string;
    created_at: string;
  }>;

  const combined = selectedRows
    .concat(variantRows)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of combined) {
    const text = textFromPartsJson(row.parts_json);
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(text);
    if (out.length >= limit) break;
  }

  return out;
}

function rowToChat(row: ChatRow): Chat {
  const { provider } = getActiveProviderConfig();
  const allowed = new Set(provider.models.map((m) => m.id));
  const modelId = allowed.has(String(row.model_id))
    ? String(row.model_id)
    : provider.defaultModelId;
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    modelId,
    chatInstructions: row.chat_instructions,
    chatInstructionsRevision: Number(row.chat_instructions_revision ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    forkedFromChatId: row.forked_from_chat_id,
    forkedFromMessageId: row.forked_from_message_id,
  };
}

export function listChats(profileId: string): Chat[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, profile_id, title, model_id, chat_instructions, chat_instructions_revision, created_at, updated_at, archived_at, deleted_at, forked_from_chat_id, forked_from_message_id
       FROM chats
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`
    )
    .all(profileId) as ChatRow[];

  return rows.map(rowToChat);
}

export function getChat(chatId: string): Chat {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, profile_id, title, model_id, chat_instructions, chat_instructions_revision, created_at, updated_at, archived_at, deleted_at, forked_from_chat_id, forked_from_message_id
       FROM chats
       WHERE id = ?`
    )
    .get(chatId) as ChatRow | undefined;

  if (!row) throw new Error("Chat not found.");
  return rowToChat(row);
}

export function createChat(input: {
  profileId: string;
  modelId?: string;
  title?: string;
  chatInstructions?: string;
  forkedFromChatId?: string;
  forkedFromMessageId?: string;
}): Chat {
  const profile = getProfile(input.profileId);
  const { provider } = getActiveProviderConfig();
  const allowed = new Set(provider.models.map((m) => m.id));
  const profileDefaultModelId = allowed.has(profile.defaultModelId)
    ? profile.defaultModelId
    : provider.defaultModelId;
  const modelId =
    typeof input.modelId === "string" && allowed.has(input.modelId)
      ? input.modelId
      : profileDefaultModelId;

  const title = (input.title ?? "").trim();
  const chatInstructions = String(input.chatInstructions ?? "");
  const now = new Date().toISOString();
  const id = nanoid();

  const db = getDb();
  db.prepare(
    `INSERT INTO chats (
       id,
       profile_id,
       title,
       model_id,
       chat_instructions,
       chat_instructions_revision,
       created_at,
       updated_at,
       archived_at,
       deleted_at,
       forked_from_chat_id,
       forked_from_message_id
     )
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, ?, ?)`
  ).run(
    id,
    profile.id,
    title,
    modelId,
    chatInstructions,
    now,
    now,
    input.forkedFromChatId ?? null,
    input.forkedFromMessageId ?? null
  );

  return getChat(id);
}

export function updateChat(
  chatId: string,
  patch: Partial<Pick<Chat, "title" | "modelId" | "chatInstructions">>
): Chat {
  const db = getDb();
  const current = getChat(chatId);

  const title = patch.title != null ? patch.title.trim() : current.title;
  if (title.length > 200) throw new Error("Chat title is too long.");

  const modelId =
    patch.modelId != null
      ? (() => {
          const { provider } = getActiveProviderConfig();
          const allowed = new Set(provider.models.map((m) => m.id));
          return allowed.has(patch.modelId) ? patch.modelId : provider.defaultModelId;
        })()
      : current.modelId;

  const chatInstructions =
    patch.chatInstructions != null
      ? String(patch.chatInstructions)
      : current.chatInstructions;

  const chatInstructionsRevision =
    patch.chatInstructions != null && chatInstructions !== current.chatInstructions
      ? current.chatInstructionsRevision + 1
      : current.chatInstructionsRevision;

  const now = new Date().toISOString();

  db.prepare(
    `UPDATE chats
     SET title = ?, model_id = ?, chat_instructions = ?, chat_instructions_revision = ?, updated_at = ?
     WHERE id = ?`
  ).run(title, modelId, chatInstructions, chatInstructionsRevision, now, chatId);

  return getChat(chatId);
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

export function archiveChat(profileId: string, chatId: string): Chat {
  const db = getDb();
  const current = assertChatWritable(profileId, chatId);
  if (current.archivedAt) return current;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE chats
     SET archived_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, now, chatId);

  return getChat(chatId);
}

export function unarchiveChat(profileId: string, chatId: string): Chat {
  const db = getDb();
  const current = assertChatWritable(profileId, chatId);
  if (!current.archivedAt) return current;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE chats
     SET archived_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(now, chatId);

  return getChat(chatId);
}

export function deleteChat(profileId: string, chatId: string): void {
  const db = getDb();
  assertChatWritable(profileId, chatId);

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE chats
     SET deleted_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, now, chatId);
}

export function listChatMessages(chatId: string): UIMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, role, parts_json
       FROM messages
       WHERE chat_id = ?
       ORDER BY position ASC, created_at ASC`
    )
    .all(chatId) as Array<Omit<MessageRow, "created_at" | "turn_user_message_id">>;

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: JSON.parse(row.parts_json) as UIMessage["parts"],
  }));
}

function getTitleFromMessages(messages: UIMessage[]) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "";
  const firstText = firstUser.parts.find((p) => p.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  if (!firstText?.text) return "";
  const t = firstText.text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

function getCreatedAtFromMessage(
  message: UIMessage<RemcoChatMessageMetadata>,
  fallback: string
) {
  const createdAt = message.metadata?.createdAt;
  if (typeof createdAt !== "string") return fallback;
  if (!Number.isFinite(Date.parse(createdAt))) return fallback;
  return createdAt;
}

export function loadChatState(chatId: string): {
  messages: UIMessage<RemcoChatMessageMetadata>[];
  variantsByUserMessageId: Record<string, UIMessage<RemcoChatMessageMetadata>[]>;
} {
  const db = getDb();

  const messageRows = db
    .prepare(
      `SELECT id, role, parts_json, created_at, turn_user_message_id, profile_instructions_revision, chat_instructions_revision
       FROM messages
       WHERE chat_id = ?
       ORDER BY position ASC, created_at ASC`
    )
    .all(chatId) as MessageRow[];

  const messages = messageRows.map((row) => ({
    id: row.id,
    role: row.role,
    metadata: {
      createdAt: row.created_at,
      turnUserMessageId: row.turn_user_message_id ?? undefined,
      profileInstructionsRevision:
        typeof row.profile_instructions_revision === "number"
          ? row.profile_instructions_revision
          : undefined,
      chatInstructionsRevision:
        typeof row.chat_instructions_revision === "number"
          ? row.chat_instructions_revision
          : undefined,
    },
    parts: JSON.parse(row.parts_json) as UIMessage["parts"],
  }));

  const variantRows = db
    .prepare(
      `SELECT id, role, parts_json, created_at, turn_user_message_id
       FROM message_variants
       WHERE chat_id = ?
       ORDER BY turn_user_message_id ASC, created_at ASC`
    )
    .all(chatId) as VariantRow[];

  const variantsByUserMessageId: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  > = {};

  for (const row of variantRows) {
    const entry = (variantsByUserMessageId[row.turn_user_message_id] ??= []);
    entry.push({
      id: row.id,
      role: row.role,
      metadata: {
        createdAt: row.created_at,
        turnUserMessageId: row.turn_user_message_id,
      },
      parts: JSON.parse(row.parts_json) as UIMessage["parts"],
    });
  }

  return { messages, variantsByUserMessageId };
}

export function exportChatSnapshot(profileId: string, chatId: string): {
  chat: Chat;
  profile: ReturnType<typeof getProfile>;
  exportedAt: string;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  variantsByUserMessageId: Record<string, UIMessage<RemcoChatMessageMetadata>[]>;
} {
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

export function exportChatMarkdown(profileId: string, chatId: string): {
  markdown: string;
  title: string;
} {
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
      `- Forked from: ${snapshot.chat.forkedFromChatId} @ ${snapshot.chat.forkedFromMessageId}`
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
    const body = textFromParts(message.parts);
    lines.push(`### ${role}`);
    lines.push("");
    lines.push(body || "_(empty)_");
    lines.push("");
  }

  const variantEntries = Object.entries(snapshot.variantsByUserMessageId).filter(
    ([, variants]) => variants.length > 0
  );

  if (variantEntries.length > 0) {
    lines.push("## Variants (Unselected)");
    lines.push("");
    for (const [turnUserMessageId, variants] of variantEntries) {
      lines.push(`### Turn ${turnUserMessageId}`);
      lines.push("");
      for (const variant of variants) {
        const at = variant.metadata?.createdAt ?? "";
        const body = textFromParts(variant.parts);
        lines.push(`- ${at || "unknown"}:`);
        lines.push("");
        lines.push("```text");
        lines.push(body);
        lines.push("```");
        lines.push("");
      }
    }
  }

  return { markdown: lines.join("\n"), title };
}

export function saveChatState(input: {
  chatId: string;
  profileId: string;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  variantsByUserMessageId?: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  >;
}): void {
  const chat = getChat(input.chatId);
  if (chat.profileId !== input.profileId) {
    throw new Error("Chat does not belong to this profile.");
  }

  const db = getDb();
  const now = new Date().toISOString();

  const insertMessage = db.prepare(
    `INSERT INTO messages (chat_id, id, role, parts_json, created_at, position, turn_user_message_id, profile_instructions_revision, chat_instructions_revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id, id) DO UPDATE SET
       role = excluded.role,
       parts_json = excluded.parts_json,
       position = excluded.position,
       turn_user_message_id = excluded.turn_user_message_id,
       profile_instructions_revision = excluded.profile_instructions_revision,
       chat_instructions_revision = excluded.chat_instructions_revision`
  );

  const insertVariant = db.prepare(
    `INSERT INTO message_variants (chat_id, id, turn_user_message_id, role, parts_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id, id) DO UPDATE SET
       turn_user_message_id = excluded.turn_user_message_id,
       role = excluded.role,
       parts_json = excluded.parts_json`
  );

  const tx = db.transaction(
    (
      messages: UIMessage<RemcoChatMessageMetadata>[],
      variantsByUserMessageId: Record<
        string,
        UIMessage<RemcoChatMessageMetadata>[]
      >
    ) => {
      let lastUserMessageId: string | null = null;
      const messageIds: string[] = [];

      for (const [position, message] of messages.entries()) {
        const turnUserMessageId =
          message.role === "assistant" ? lastUserMessageId : null;
        if (message.role === "user") lastUserMessageId = message.id;

        messageIds.push(message.id);

      insertMessage.run(
        chat.id,
        message.id,
        message.role,
        JSON.stringify(message.parts),
        getCreatedAtFromMessage(message, now),
        position,
        turnUserMessageId,
        typeof message.metadata?.profileInstructionsRevision === "number"
          ? message.metadata.profileInstructionsRevision
          : null,
        typeof message.metadata?.chatInstructionsRevision === "number"
          ? message.metadata.chatInstructionsRevision
          : null
      );
    }

      if (messageIds.length === 0) {
        db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chat.id);
      } else {
        const placeholders = messageIds.map(() => "?").join(", ");
        db.prepare(
          `DELETE FROM messages
           WHERE chat_id = ? AND id NOT IN (${placeholders})`
        ).run(chat.id, ...messageIds);
      }

      const variantIds: string[] = [];
      for (const [turnUserMessageId, variants] of Object.entries(
        variantsByUserMessageId
      )) {
        for (const variant of variants) {
          if (variant.role !== "assistant") continue;
          variantIds.push(variant.id);
          insertVariant.run(
            chat.id,
            variant.id,
            turnUserMessageId,
            variant.role,
            JSON.stringify(variant.parts),
            getCreatedAtFromMessage(variant, now)
          );
        }
      }

      if (variantIds.length === 0) {
        db.prepare(`DELETE FROM message_variants WHERE chat_id = ?`).run(chat.id);
      } else {
        const placeholders = variantIds.map(() => "?").join(", ");
        db.prepare(
          `DELETE FROM message_variants
           WHERE chat_id = ? AND id NOT IN (${placeholders})`
        ).run(chat.id, ...variantIds);
      }

      const currentTitle = chat.title.trim();
      const inferredTitle = currentTitle
        ? ""
        : getTitleFromMessages(messages as UIMessage[]);

      db.prepare(
        `UPDATE chats
         SET updated_at = ?, title = CASE WHEN ? != '' THEN ? ELSE title END
         WHERE id = ?`
      ).run(now, inferredTitle, inferredTitle, chat.id);
    }
  );

  tx(input.messages, input.variantsByUserMessageId ?? {});
}

function updateUserMessageText(
  message: UIMessage<RemcoChatMessageMetadata>,
  text: string
): UIMessage<RemcoChatMessageMetadata> {
  const nextText = text.trim();
  if (!nextText) throw new Error("Message text cannot be empty.");

  const parts = [...message.parts];
  let hasText = false;
  const nextParts = parts
    .map((p) => {
      if (p.type !== "text") return p;
      if (hasText) return null;
      hasText = true;
      return { ...p, text: nextText };
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

export function forkChatFromUserMessage(input: {
  profileId: string;
  chatId: string;
  userMessageId: string;
  text: string;
}): Chat {
  const originalChat = getChat(input.chatId);
  if (originalChat.profileId !== input.profileId) {
    throw new Error("Chat does not belong to this profile.");
  }

  const { messages, variantsByUserMessageId } = loadChatState(originalChat.id);
  const index = messages.findIndex((m) => m.id === input.userMessageId);
  if (index === -1) throw new Error("Message not found.");

  const target = messages[index];
  if (!target || target.role !== "user") {
    throw new Error("Only user messages can be edited.");
  }

  const forkMessages = messages.slice(0, index + 1);
  forkMessages[index] = updateUserMessageText(target, input.text);

  const allowedUserIds = new Set(
    forkMessages.filter((m) => m.role === "user").map((m) => m.id)
  );

  const forkVariants: Record<
    string,
    UIMessage<RemcoChatMessageMetadata>[]
  > = {};

  for (const [userMessageId, variants] of Object.entries(
    variantsByUserMessageId
  )) {
    if (!allowedUserIds.has(userMessageId)) continue;
    forkVariants[userMessageId] = variants;
  }

  // Preserve fork-source assistant responses for the edited turn as variants in the fork.
  // This matches ChatGPT-like branching: after editing and regenerating, the user can still
  // page back to the original (pre-edit) responses.
  {
    const sourceTurnAssistantMessages: UIMessage<RemcoChatMessageMetadata>[] = [];
    for (let i = index + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.role !== "assistant") break;
      sourceTurnAssistantMessages.push({
        ...msg,
        metadata: {
          ...(msg.metadata ?? {}),
          turnUserMessageId: input.userMessageId,
        },
      });
    }

    const existing = forkVariants[input.userMessageId] ?? [];
    if (existing.length > 0 || sourceTurnAssistantMessages.length > 0) {
      const byId = new Map<string, UIMessage<RemcoChatMessageMetadata>>();
      for (const v of existing) {
        if (v.role !== "assistant") continue;
        byId.set(v.id, v);
      }
      for (const v of sourceTurnAssistantMessages) {
        if (v.role !== "assistant") continue;
        byId.set(v.id, v);
      }
      forkVariants[input.userMessageId] = Array.from(byId.values());
    }
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
