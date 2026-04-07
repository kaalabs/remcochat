import { getDb } from "@/server/db";

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

type AssistantTextRow = {
  parts_json: string;
  created_at: string;
};

export type StoredChatRecord = {
  id: string;
  profileId: string;
  title: string;
  modelId: string;
  folderId: string | null;
  chatInstructions: string;
  chatInstructionsRevision: number;
  activatedSkillNamesJson: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  forkedFromChatId: string | null;
  forkedFromMessageId: string | null;
  pinnedAt: string | null;
};

export type StoredAccessibleChatRecord = StoredChatRecord & {
  ownerName: string;
  scope: "owned" | "shared";
};

export type StoredChatMessageRecord = {
  id: string;
  role: "system" | "user" | "assistant";
  partsJson: string;
  createdAt: string;
  turnUserMessageId: string | null;
  profileInstructionsRevision: number | null;
  chatInstructionsRevision: number | null;
};

export type StoredChatVariantRecord = {
  id: string;
  role: "assistant";
  partsJson: string;
  createdAt: string;
  turnUserMessageId: string;
};

export type StoredAssistantTextRecord = {
  partsJson: string;
  createdAt: string;
};

export type StoredPersistedChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  partsJson: string;
  createdAt: string;
  position: number;
  turnUserMessageId: string | null;
  profileInstructionsRevision: number | null;
  chatInstructionsRevision: number | null;
};

export type StoredPersistedChatVariant = {
  id: string;
  role: "assistant";
  partsJson: string;
  createdAt: string;
  turnUserMessageId: string;
};

export type ChatsRepository = {
  listTurnAssistantMessageRecords(input: {
    chatId: string;
    turnUserMessageId: string;
    limit: number;
  }): StoredAssistantTextRecord[];
  listTurnAssistantVariantRecords(input: {
    chatId: string;
    turnUserMessageId: string;
    limit: number;
  }): StoredAssistantTextRecord[];
  listOwnedChatRecords(profileId: string): StoredChatRecord[];
  listAccessibleChatRecords(profileId: string): StoredAccessibleChatRecord[];
  getChatRecord(chatId: string): StoredChatRecord | null;
  getAccessibleChatRecord(
    profileId: string,
    chatId: string,
  ): StoredAccessibleChatRecord | null;
  upsertChatPin(profileId: string, chatId: string, pinnedAt: string): void;
  deleteChatPin(profileId: string, chatId: string): void;
  getActivatedSkillNamesJson(chatId: string): string | null;
  updateActivatedSkillNames(chatId: string, activatedSkillNamesJson: string, updatedAt: string): void;
  createChatRecord(input: {
    id: string;
    profileId: string;
    title: string;
    modelId: string;
    chatInstructions: string;
    createdAt: string;
    updatedAt: string;
    forkedFromChatId: string | null;
    forkedFromMessageId: string | null;
  }): StoredChatRecord;
  updateChatCore(input: {
    chatId: string;
    title: string;
    modelId: string;
    chatInstructions: string;
    chatInstructionsRevision: number;
    updatedAt: string;
  }): void;
  folderExistsForOwner(profileId: string, folderId: string): boolean;
  updateChatFolder(profileId: string, chatId: string, folderId: string | null): void;
  updateChatArchiveState(chatId: string, archivedAt: string | null, updatedAt: string): void;
  updateChatDeletedState(chatId: string, deletedAt: string, updatedAt: string): void;
  listMessageRecords(chatId: string): StoredChatMessageRecord[];
  listVariantRecords(chatId: string): StoredChatVariantRecord[];
  replaceChatState(input: {
    chatId: string;
    messages: StoredPersistedChatMessage[];
    variants: StoredPersistedChatVariant[];
    updatedAt: string;
    inferredTitle: string;
  }): void;
};

const CHAT_SELECT = `
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
    chats.forked_from_message_id as forked_from_message_id
`;

const ACCESSIBLE_CHAT_SELECT = `
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
`;

function rowToStoredChatRecord(row: ChatRow): StoredChatRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    modelId: row.model_id,
    folderId: row.folder_id ?? null,
    chatInstructions: row.chat_instructions,
    chatInstructionsRevision: Number(row.chat_instructions_revision ?? 1),
    activatedSkillNamesJson: row.activated_skill_names_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    forkedFromChatId: row.forked_from_chat_id,
    forkedFromMessageId: row.forked_from_message_id,
    pinnedAt: row.pinned_at ?? null,
  };
}

function rowToStoredAccessibleChatRecord(row: AccessibleChatRow): StoredAccessibleChatRecord {
  return {
    ...rowToStoredChatRecord(row),
    ownerName: row.owner_name,
    scope: row.scope,
  };
}

function rowToStoredMessageRecord(row: MessageRow): StoredChatMessageRecord {
  return {
    id: row.id,
    role: row.role,
    partsJson: row.parts_json,
    createdAt: row.created_at,
    turnUserMessageId: row.turn_user_message_id,
    profileInstructionsRevision: row.profile_instructions_revision,
    chatInstructionsRevision: row.chat_instructions_revision,
  };
}

function rowToStoredVariantRecord(row: VariantRow): StoredChatVariantRecord {
  return {
    id: row.id,
    role: row.role,
    partsJson: row.parts_json,
    createdAt: row.created_at,
    turnUserMessageId: row.turn_user_message_id,
  };
}

function rowToStoredAssistantTextRecord(row: AssistantTextRow): StoredAssistantTextRecord {
  return {
    partsJson: row.parts_json,
    createdAt: row.created_at,
  };
}

export function createSqliteChatsRepository(): ChatsRepository {
  function listTurnAssistantMessageRecords(input: {
    chatId: string;
    turnUserMessageId: string;
    limit: number;
  }) {
    const rows = getDb()
      .prepare(
        `SELECT parts_json, created_at
         FROM messages
         WHERE chat_id = ? AND role = 'assistant' AND turn_user_message_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(input.chatId, input.turnUserMessageId, input.limit) as AssistantTextRow[];
    return rows.map(rowToStoredAssistantTextRecord);
  }

  function listTurnAssistantVariantRecords(input: {
    chatId: string;
    turnUserMessageId: string;
    limit: number;
  }) {
    const rows = getDb()
      .prepare(
        `SELECT parts_json, created_at
         FROM message_variants
         WHERE chat_id = ? AND turn_user_message_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(input.chatId, input.turnUserMessageId, input.limit) as AssistantTextRow[];
    return rows.map(rowToStoredAssistantTextRecord);
  }

  function listOwnedChatRecords(profileId: string) {
    const rows = getDb()
      .prepare(
        `${CHAT_SELECT},
         chat_pins.pinned_at as pinned_at
         FROM chats
         LEFT JOIN chat_pins
           ON chat_pins.chat_id = chats.id
          AND chat_pins.profile_id = ?
         WHERE chats.profile_id = ? AND chats.deleted_at IS NULL
         ORDER BY (chat_pins.pinned_at IS NOT NULL) DESC, chat_pins.pinned_at DESC, chats.updated_at DESC`,
      )
      .all(profileId, profileId) as ChatRow[];
    return rows.map(rowToStoredChatRecord);
  }

  function listAccessibleChatRecords(profileId: string) {
    const rows = getDb()
      .prepare(
        `
          ${ACCESSIBLE_CHAT_SELECT}
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
          ORDER BY (chat_pins.pinned_at IS NOT NULL) DESC, chat_pins.pinned_at DESC, chats.updated_at DESC
        `,
      )
      .all(profileId, profileId, profileId, profileId, profileId) as AccessibleChatRow[];
    return rows.map(rowToStoredAccessibleChatRecord);
  }

  function getChatRecord(chatId: string) {
    const row = getDb()
      .prepare(
        `${CHAT_SELECT}
         FROM chats
         WHERE id = ?`,
      )
      .get(chatId) as ChatRow | undefined;
    return row ? rowToStoredChatRecord(row) : null;
  }

  function getAccessibleChatRecord(profileId: string, chatId: string) {
    const row = getDb()
      .prepare(
        `
          ${ACCESSIBLE_CHAT_SELECT}
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
        `,
      )
      .get(profileId, profileId, profileId, chatId, profileId, profileId) as
      | AccessibleChatRow
      | undefined;
    return row ? rowToStoredAccessibleChatRecord(row) : null;
  }

  function upsertChatPin(profileId: string, chatId: string, pinnedAt: string) {
    getDb()
      .prepare(
        `INSERT INTO chat_pins (profile_id, chat_id, pinned_at)
         VALUES (?, ?, ?)
         ON CONFLICT(profile_id, chat_id) DO UPDATE SET
           pinned_at = excluded.pinned_at`,
      )
      .run(profileId, chatId, pinnedAt);
  }

  function deleteChatPin(profileId: string, chatId: string) {
    getDb()
      .prepare(`DELETE FROM chat_pins WHERE profile_id = ? AND chat_id = ?`)
      .run(profileId, chatId);
  }

  function getActivatedSkillNamesJson(chatId: string) {
    const row = getDb()
      .prepare(`SELECT activated_skill_names_json FROM chats WHERE id = ?`)
      .get(chatId) as { activated_skill_names_json: string } | undefined;
    return row?.activated_skill_names_json ?? null;
  }

  function updateActivatedSkillNames(
    chatId: string,
    activatedSkillNamesJson: string,
    updatedAt: string,
  ) {
    getDb()
      .prepare(
        `UPDATE chats
         SET activated_skill_names_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(activatedSkillNamesJson, updatedAt, chatId);
  }

  function createChatRecord(input: {
    id: string;
    profileId: string;
    title: string;
    modelId: string;
    chatInstructions: string;
    createdAt: string;
    updatedAt: string;
    forkedFromChatId: string | null;
    forkedFromMessageId: string | null;
  }) {
    getDb()
      .prepare(
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
         VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.profileId,
        input.title,
        input.modelId,
        input.chatInstructions,
        input.createdAt,
        input.updatedAt,
        input.forkedFromChatId,
        input.forkedFromMessageId,
      );

    return getChatRecord(input.id)!;
  }

  function updateChatCore(input: {
    chatId: string;
    title: string;
    modelId: string;
    chatInstructions: string;
    chatInstructionsRevision: number;
    updatedAt: string;
  }) {
    getDb()
      .prepare(
        `UPDATE chats
         SET title = ?, model_id = ?, chat_instructions = ?, chat_instructions_revision = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title,
        input.modelId,
        input.chatInstructions,
        input.chatInstructionsRevision,
        input.updatedAt,
        input.chatId,
      );
  }

  function folderExistsForOwner(profileId: string, folderId: string) {
    const row = getDb()
      .prepare(`SELECT 1 AS ok FROM chat_folders WHERE id = ? AND profile_id = ?`)
      .get(folderId, profileId) as { ok: number } | undefined;
    return Boolean(row);
  }

  function updateChatFolder(profileId: string, chatId: string, folderId: string | null) {
    getDb()
      .prepare(
        `UPDATE chats
         SET folder_id = ?
         WHERE id = ? AND profile_id = ?`,
      )
      .run(folderId, chatId, profileId);
  }

  function updateChatArchiveState(
    chatId: string,
    archivedAt: string | null,
    updatedAt: string,
  ) {
    getDb()
      .prepare(
        archivedAt == null
          ? `UPDATE chats SET archived_at = NULL, updated_at = ? WHERE id = ?`
          : `UPDATE chats SET archived_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(...(archivedAt == null ? [updatedAt, chatId] : [archivedAt, updatedAt, chatId]));
  }

  function updateChatDeletedState(chatId: string, deletedAt: string, updatedAt: string) {
    getDb()
      .prepare(
        `UPDATE chats
         SET deleted_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(deletedAt, updatedAt, chatId);
  }

  function listMessageRecords(chatId: string) {
    const rows = getDb()
      .prepare(
        `SELECT id, role, parts_json, created_at, turn_user_message_id, profile_instructions_revision, chat_instructions_revision
         FROM messages
         WHERE chat_id = ?
         ORDER BY position ASC, created_at ASC`,
      )
      .all(chatId) as MessageRow[];
    return rows.map(rowToStoredMessageRecord);
  }

  function listVariantRecords(chatId: string) {
    const rows = getDb()
      .prepare(
        `SELECT id, role, parts_json, created_at, turn_user_message_id
         FROM message_variants
         WHERE chat_id = ?
         ORDER BY turn_user_message_id ASC, created_at ASC`,
      )
      .all(chatId) as VariantRow[];
    return rows.map(rowToStoredVariantRecord);
  }

  function replaceChatState(input: {
    chatId: string;
    messages: StoredPersistedChatMessage[];
    variants: StoredPersistedChatVariant[];
    updatedAt: string;
    inferredTitle: string;
  }) {
    const db = getDb();
    const insertMessage = db.prepare(
      `INSERT INTO messages (chat_id, id, role, parts_json, created_at, position, turn_user_message_id, profile_instructions_revision, chat_instructions_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, id) DO UPDATE SET
         role = excluded.role,
         parts_json = excluded.parts_json,
         position = excluded.position,
         turn_user_message_id = excluded.turn_user_message_id,
         profile_instructions_revision = excluded.profile_instructions_revision,
         chat_instructions_revision = excluded.chat_instructions_revision`,
    );
    const insertVariant = db.prepare(
      `INSERT INTO message_variants (chat_id, id, turn_user_message_id, role, parts_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, id) DO UPDATE SET
         turn_user_message_id = excluded.turn_user_message_id,
         role = excluded.role,
         parts_json = excluded.parts_json`,
    );

    const tx = db.transaction(() => {
      const messageIds: string[] = [];
      for (const message of input.messages) {
        messageIds.push(message.id);
        insertMessage.run(
          input.chatId,
          message.id,
          message.role,
          message.partsJson,
          message.createdAt,
          message.position,
          message.turnUserMessageId,
          message.profileInstructionsRevision,
          message.chatInstructionsRevision,
        );
      }

      if (messageIds.length === 0) {
        db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(input.chatId);
      } else {
        const placeholders = messageIds.map(() => "?").join(", ");
        db.prepare(
          `DELETE FROM messages
           WHERE chat_id = ? AND id NOT IN (${placeholders})`,
        ).run(input.chatId, ...messageIds);
      }

      const variantIds: string[] = [];
      for (const variant of input.variants) {
        variantIds.push(variant.id);
        insertVariant.run(
          input.chatId,
          variant.id,
          variant.turnUserMessageId,
          variant.role,
          variant.partsJson,
          variant.createdAt,
        );
      }

      if (variantIds.length === 0) {
        db.prepare(`DELETE FROM message_variants WHERE chat_id = ?`).run(input.chatId);
      } else {
        const placeholders = variantIds.map(() => "?").join(", ");
        db.prepare(
          `DELETE FROM message_variants
           WHERE chat_id = ? AND id NOT IN (${placeholders})`,
        ).run(input.chatId, ...variantIds);
      }

      db.prepare(
        `UPDATE chats
         SET updated_at = ?, title = CASE WHEN ? != '' THEN ? ELSE title END
         WHERE id = ?`,
      ).run(input.updatedAt, input.inferredTitle, input.inferredTitle, input.chatId);
    });

    tx();
  }

  return {
    listTurnAssistantMessageRecords,
    listTurnAssistantVariantRecords,
    listOwnedChatRecords,
    listAccessibleChatRecords,
    getChatRecord,
    getAccessibleChatRecord,
    upsertChatPin,
    deleteChatPin,
    getActivatedSkillNamesJson,
    updateActivatedSkillNames,
    createChatRecord,
    updateChatCore,
    folderExistsForOwner,
    updateChatFolder,
    updateChatArchiveState,
    updateChatDeletedState,
    listMessageRecords,
    listVariantRecords,
    replaceChatState,
  };
}

export const sqliteChatsRepository = createSqliteChatsRepository();
