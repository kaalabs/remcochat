import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db: Database.Database | null = null;

function initSchema(database: Database.Database) {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      default_model_id TEXT NOT NULL,
      custom_instructions TEXT NOT NULL DEFAULT '',
      custom_instructions_revision INTEGER NOT NULL DEFAULT 1,
      memory_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS profile_memory (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profile_memory_profile_updated_at
      ON profile_memory(profile_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      chat_instructions TEXT NOT NULL DEFAULT '',
      chat_instructions_revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT,
      forked_from_chat_id TEXT,
      forked_from_message_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_chats_profile_updated_at
      ON chats(profile_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
      temporary_session_id TEXT,
      message_id TEXT,
      original_filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_profile_created_at
      ON attachments(profile_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_attachments_chat_created_at
      ON attachments(chat_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_attachments_temporary_session_created_at
      ON attachments(temporary_session_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_attachments_expires_at
      ON attachments(expires_at);

    CREATE TABLE IF NOT EXISTS pending_memory (
      chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_memory_profile_updated_at
      ON pending_memory(profile_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'todo',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_profile_name
      ON lists(profile_id, name COLLATE NOCASE);

    CREATE INDEX IF NOT EXISTS idx_lists_profile_updated_at
      ON lists(profile_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS list_items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_list_items_list_position
      ON list_items(list_id, position ASC);

    CREATE INDEX IF NOT EXISTS idx_list_items_list_completed
      ON list_items(list_id, completed, position ASC);

    CREATE TABLE IF NOT EXISTS list_members (
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (list_id, profile_id)
    );

    CREATE INDEX IF NOT EXISTS idx_list_members_profile
      ON list_members(profile_id);

    CREATE TABLE IF NOT EXISTS quick_notes (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_quick_notes_profile_updated_at
      ON quick_notes(profile_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agenda_items (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      start_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      timezone TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agenda_items_profile_start_at
      ON agenda_items(profile_id, start_at ASC);

    CREATE INDEX IF NOT EXISTS idx_agenda_items_profile_updated_at
      ON agenda_items(profile_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agenda_item_members (
      agenda_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (agenda_item_id, profile_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agenda_item_members_profile
      ON agenda_item_members(profile_id);

    CREATE TABLE IF NOT EXISTS messages (
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      role TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      turn_user_message_id TEXT,
      profile_instructions_revision INTEGER,
      chat_instructions_revision INTEGER,
      PRIMARY KEY(chat_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_created_at
      ON messages(chat_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS message_variants (
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      turn_user_message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(chat_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_variants_chat_turn_created
      ON message_variants(chat_id, turn_user_message_id, created_at ASC);
  `);

  const columns = database
    .prepare(`PRAGMA table_info(messages)`)
    .all() as Array<{ name: string }>;

  const hasPosition = columns.some((c) => c.name === "position");
  if (!hasPosition) {
    database.exec(`ALTER TABLE messages ADD COLUMN position INTEGER NOT NULL DEFAULT 0;`);
  }

  const hasTurnUserMessageId = columns.some(
    (c) => c.name === "turn_user_message_id"
  );
  if (!hasTurnUserMessageId) {
    database.exec(`ALTER TABLE messages ADD COLUMN turn_user_message_id TEXT;`);
  }

  const hasMessagesProfileInstructionsRevision = columns.some(
    (c) => c.name === "profile_instructions_revision"
  );
  if (!hasMessagesProfileInstructionsRevision) {
    database.exec(
      `ALTER TABLE messages ADD COLUMN profile_instructions_revision INTEGER;`
    );
  }

  const hasMessagesChatInstructionsRevision = columns.some(
    (c) => c.name === "chat_instructions_revision"
  );
  if (!hasMessagesChatInstructionsRevision) {
    database.exec(
      `ALTER TABLE messages ADD COLUMN chat_instructions_revision INTEGER;`
    );
  }

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_chat_position ON messages(chat_id, position ASC);`
  );

  const chatColumns = database
    .prepare(`PRAGMA table_info(chats)`)
    .all() as Array<{ name: string }>;

  const profileColumns = database
    .prepare(`PRAGMA table_info(profiles)`)
    .all() as Array<{ name: string }>;

  const hasProfileInstructionsRevision = profileColumns.some(
    (c) => c.name === "custom_instructions_revision"
  );
  if (!hasProfileInstructionsRevision) {
    database.exec(
      `ALTER TABLE profiles ADD COLUMN custom_instructions_revision INTEGER NOT NULL DEFAULT 1;`
    );
  }

  const hasForkedFromChatId = chatColumns.some(
    (c) => c.name === "forked_from_chat_id"
  );
  if (!hasForkedFromChatId) {
    database.exec(`ALTER TABLE chats ADD COLUMN forked_from_chat_id TEXT;`);
  }

  const hasForkedFromMessageId = chatColumns.some(
    (c) => c.name === "forked_from_message_id"
  );
  if (!hasForkedFromMessageId) {
    database.exec(`ALTER TABLE chats ADD COLUMN forked_from_message_id TEXT;`);
  }

  const hasChatInstructionsRevision = chatColumns.some(
    (c) => c.name === "chat_instructions_revision"
  );
  if (!hasChatInstructionsRevision) {
    database.exec(
      `ALTER TABLE chats ADD COLUMN chat_instructions_revision INTEGER NOT NULL DEFAULT 1;`
    );
  }
}

export function getDb() {
  if (db) {
    initSchema(db);
    return db;
  }

  const dbPath =
    process.env.REMCOCHAT_DB_PATH ??
    path.join(process.cwd(), "data", "remcochat.sqlite");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initSchema(db);

  return db;
}
