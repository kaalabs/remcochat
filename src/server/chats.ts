import type { Chat, RemcoChatMessageMetadata } from "@/lib/types";
import { validateChatTitle } from "@/lib/chat-title";
import type { UIMessage } from "ai";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { getProfile } from "./profiles";
import { getActiveProviderConfig } from "@/server/model-registry";
import { stripWebToolPartsFromMessages } from "@/server/message-sanitize";
import { deleteAttachmentsForChat } from "@/server/attachments";
import { logEvent } from "@/server/log";

type ChatRow = {
  id: string;
  profile_id: string;
  title: string;
  model_id: string;
  folder_id: string | null;
  chat_instructions: string;
  chat_instructions_revision: number;
  activated_skill_names_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  forked_from_chat_id: string | null;
  forked_from_message_id: string | null;
  pinned_at?: string | null;
};

type AccessibleChatRow = ChatRow & {
  owner_name: string;
  scope: "owned" | "shared";
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

function activatedSkillNamesFromJson(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      const name = String(entry ?? "").trim();
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
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
  const allowed = new Set(provider.allowedModelIds);
  const modelId = allowed.has(String(row.model_id))
    ? String(row.model_id)
    : provider.defaultModelId;
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    modelId,
    folderId: row.folder_id ?? null,
    pinnedAt: row.pinned_at ?? null,
    chatInstructions: row.chat_instructions,
    chatInstructionsRevision: Number(row.chat_instructions_revision ?? 1),
    activatedSkillNames: activatedSkillNamesFromJson(row.activated_skill_names_json),
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
      `SELECT
         chats.id as id,
         chats.profile_id as profile_id,
         chats.title as title,
         chats.model_id as model_id,
         chats.folder_id as folder_id,
         chats.chat_instructions as chat_instructions,
         chats.chat_instructions_revision as chat_instructions_revision,
         chats.activated_skill_names_json as activated_skill_names_json,
         chats.created_at as created_at,
         chats.updated_at as updated_at,
         chats.archived_at as archived_at,
         chats.deleted_at as deleted_at,
         chats.forked_from_chat_id as forked_from_chat_id,
         chats.forked_from_message_id as forked_from_message_id,
         chat_pins.pinned_at as pinned_at
       FROM chats
       LEFT JOIN chat_pins
         ON chat_pins.chat_id = chats.id
       AND chat_pins.profile_id = ?
       WHERE chats.profile_id = ? AND chats.deleted_at IS NULL
       ORDER BY (chat_pins.pinned_at IS NOT NULL) DESC, chat_pins.pinned_at DESC, chats.updated_at DESC, chats.created_at DESC, chats.id DESC`
    )
    .all(profileId, profileId) as ChatRow[];

  return rows.map(rowToChat);
}

export function listAccessibleChats(profileId: string): Array<Chat & {
  scope: "owned" | "shared";
  ownerName: string;
}> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          chats.id as id,
          chats.profile_id as profile_id,
          chats.title as title,
          chats.model_id as model_id,
          chats.folder_id as folder_id,
          chats.chat_instructions as chat_instructions,
          chats.chat_instructions_revision as chat_instructions_revision,
          chats.activated_skill_names_json as activated_skill_names_json,
          chats.created_at as created_at,
          chats.updated_at as updated_at,
          chats.archived_at as archived_at,
          chats.deleted_at as deleted_at,
          chats.forked_from_chat_id as forked_from_chat_id,
          chats.forked_from_message_id as forked_from_message_id,
          chat_pins.pinned_at as pinned_at,
          profiles.name as owner_name,
          CASE WHEN chats.profile_id = ? THEN 'owned' ELSE 'shared' END as scope
        FROM chats
        JOIN profiles ON profiles.id = chats.profile_id
        LEFT JOIN chat_pins
          ON chat_pins.chat_id = chats.id
         AND chat_pins.profile_id = ?
        LEFT JOIN chat_folder_members
          ON chat_folder_members.folder_id = chats.folder_id
         AND chat_folder_members.profile_id = ?
        WHERE chats.deleted_at IS NULL
          AND (
            chats.profile_id = ?
            OR chat_folder_members.profile_id = ?
          )
        ORDER BY (chat_pins.pinned_at IS NOT NULL) DESC, chat_pins.pinned_at DESC, chats.updated_at DESC, chats.created_at DESC, chats.id DESC
      `
    )
    .all(profileId, profileId, profileId, profileId, profileId) as AccessibleChatRow[];

  return rows.map((row) => ({
    ...rowToChat(row),
    scope: row.scope,
    ownerName: row.owner_name,
  }));
}

export function getChat(chatId: string): Chat {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, profile_id, title, model_id, folder_id, chat_instructions, chat_instructions_revision, activated_skill_names_json, created_at, updated_at, archived_at, deleted_at, forked_from_chat_id, forked_from_message_id
       FROM chats
       WHERE id = ?`
    )
    .get(chatId) as ChatRow | undefined;

  if (!row) throw new Error("Chat not found.");
  return rowToChat(row);
}

export function getChatForViewer(profileId: string, chatId: string): Chat & {
  scope: "owned" | "shared";
  ownerName: string;
} {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          chats.id as id,
          chats.profile_id as profile_id,
          chats.title as title,
          chats.model_id as model_id,
          chats.folder_id as folder_id,
          chats.chat_instructions as chat_instructions,
          chats.chat_instructions_revision as chat_instructions_revision,
          chats.activated_skill_names_json as activated_skill_names_json,
          chats.created_at as created_at,
          chats.updated_at as updated_at,
          chats.archived_at as archived_at,
          chats.deleted_at as deleted_at,
          chats.forked_from_chat_id as forked_from_chat_id,
          chats.forked_from_message_id as forked_from_message_id,
          chat_pins.pinned_at as pinned_at,
          profiles.name as owner_name,
          CASE WHEN chats.profile_id = ? THEN 'owned' ELSE 'shared' END as scope
        FROM chats
        JOIN profiles ON profiles.id = chats.profile_id
        LEFT JOIN chat_pins
          ON chat_pins.chat_id = chats.id
         AND chat_pins.profile_id = ?
        LEFT JOIN chat_folder_members
          ON chat_folder_members.folder_id = chats.folder_id
         AND chat_folder_members.profile_id = ?
        WHERE chats.id = ?
          AND chats.deleted_at IS NULL
          AND (
            chats.profile_id = ?
            OR chat_folder_members.profile_id = ?
          )
        LIMIT 1
      `
    )
    .get(profileId, profileId, profileId, chatId, profileId, profileId) as AccessibleChatRow
    | undefined;

  if (!row) {
    throw new Error("Chat not accessible.");
  }

  return {
    ...rowToChat(row),
    scope: row.scope,
    ownerName: row.owner_name,
  };
}

export function pinChat(profileId: string, chatId: string): Chat & {
  scope: "owned" | "shared";
  ownerName: string;
} {
  getChatForViewer(profileId, chatId);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_pins (profile_id, chat_id, pinned_at)
     VALUES (?, ?, ?)
     ON CONFLICT(profile_id, chat_id) DO UPDATE SET
       pinned_at = excluded.pinned_at`
  ).run(profileId, chatId, now);
  return getChatForViewer(profileId, chatId);
}

export function unpinChat(profileId: string, chatId: string): Chat & {
  scope: "owned" | "shared";
  ownerName: string;
} {
  getChatForViewer(profileId, chatId);
  const db = getDb();
  db.prepare(`DELETE FROM chat_pins WHERE profile_id = ? AND chat_id = ?`).run(
    profileId,
    chatId
  );
  return getChatForViewer(profileId, chatId);
}

export function recordActivatedSkillName(input: {
  chatId: string;
  skillName: string;
}): string[] {
  const chatId = String(input.chatId ?? "").trim();
  if (!chatId) throw new Error("Missing chat id.");

  const skillName = String(input.skillName ?? "").trim();
  if (!skillName) throw new Error("Missing skill name.");

  const db = getDb();
  const row = db
    .prepare(`SELECT activated_skill_names_json FROM chats WHERE id = ?`)
    .get(chatId) as { activated_skill_names_json: string } | undefined;
  if (!row) throw new Error("Chat not found.");

  const existing = activatedSkillNamesFromJson(row.activated_skill_names_json);
  if (existing.includes(skillName)) return existing;

  const next = existing.concat(skillName);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE chats
     SET activated_skill_names_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(next), now, chatId);

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
  const allowed = new Set(provider.allowedModelIds);
  const modelId =
    typeof input.modelId === "string" && allowed.has(input.modelId)
      ? input.modelId
      : provider.defaultModelId;

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
       folder_id,
       chat_instructions,
       chat_instructions_revision,
       created_at,
       updated_at,
       archived_at,
       deleted_at,
       forked_from_chat_id,
       forked_from_message_id
     )
     VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?, NULL, NULL, ?, ?)`
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

  const title =
    patch.title != null
      ? (() => {
          const next = validateChatTitle(String(patch.title));
          if (!next.ok) throw new Error(next.error);
          return next.title;
        })()
      : current.title;

  const modelId =
    patch.modelId != null
      ? (() => {
          const { provider } = getActiveProviderConfig();
          const allowed = new Set(provider.allowedModelIds);
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

export function updateChatForProfile(
  profileId: string,
  chatId: string,
  patch: Partial<Pick<Chat, "title" | "modelId" | "chatInstructions" | "folderId">>
): Chat {
  assertChatWritable(profileId, chatId);

  const db = getDb();

  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) {
      const folderRow = db
        .prepare(
          `SELECT 1 AS ok FROM chat_folders WHERE id = ? AND profile_id = ?`
        )
        .get(patch.folderId, profileId) as { ok: number } | undefined;
      if (!folderRow) {
        throw new Error("Folder not found.");
      }
    }

    db.prepare(
      `UPDATE chats
       SET folder_id = ?
       WHERE id = ? AND profile_id = ?`
    ).run(patch.folderId, chatId, profileId);
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

export async function deleteChat(profileId: string, chatId: string): Promise<void> {
  const db = getDb();
  assertChatWritable(profileId, chatId);

  await deleteAttachmentsForChat({ profileId, chatId });

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
  const chat = getChatForViewer(input.profileId, input.chatId);

  const messages = stripWebToolPartsFromMessages(input.messages);
  const variantsByUserMessageId = Object.fromEntries(
    Object.entries(input.variantsByUserMessageId ?? {}).map(([turnId, variants]) => [
      turnId,
      stripWebToolPartsFromMessages(variants),
    ])
  );

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

  tx(messages, variantsByUserMessageId);
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
