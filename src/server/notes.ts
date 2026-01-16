import { nanoid } from "nanoid";
import { getDb } from "@/server/db";
import { normalizeNoteContent } from "@/lib/notes";
import type { NotesToolOutput, QuickNote } from "@/lib/types";

const MAX_NOTE_LENGTH = 4000;
const MAX_NOTES = 500;
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;

type NoteRow = {
  id: string;
  profile_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type NoteActionInput = {
  action: "show" | "create" | "delete";
  content?: string;
  noteId?: string;
  noteIndex?: number;
  limit?: number;
};

function rowToNote(row: NoteRow): QuickNote {
  return {
    id: row.id,
    profileId: row.profile_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clampLimit(limit?: number) {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
}

function countNotes(profileId: string) {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(1) as count FROM quick_notes WHERE profile_id = ?`)
    .get(profileId) as { count?: number } | undefined;
  return row?.count ?? 0;
}

export function listProfileNotes(profileId: string, limit = DEFAULT_LIMIT): QuickNote[] {
  const db = getDb();
  const safeLimit = clampLimit(limit);
  const rows = db
    .prepare(
      `
        SELECT id, profile_id, content, created_at, updated_at
        FROM quick_notes
        WHERE profile_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `
    )
    .all(profileId, safeLimit) as NoteRow[];
  return rows.map(rowToNote);
}

function ensureContent(content: string) {
  const normalized = normalizeNoteContent(content);
  if (!normalized) {
    throw new Error("Note content is required.");
  }
  if (normalized.length > MAX_NOTE_LENGTH) {
    throw new Error("Note is too long.");
  }
  return normalized;
}

function resolveNoteIdByIndex(profileId: string, index: number) {
  const db = getDb();
  const offset = Math.max(0, index - 1);
  const row = db
    .prepare(
      `
        SELECT id
        FROM quick_notes
        WHERE profile_id = ?
        ORDER BY updated_at DESC
        LIMIT 1 OFFSET ?
      `
    )
    .get(profileId, offset) as { id?: string } | undefined;
  return row?.id ?? null;
}

function getNoteById(profileId: string, noteId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, profile_id, content, created_at, updated_at
        FROM quick_notes
        WHERE id = ? AND profile_id = ?
      `
    )
    .get(noteId, profileId) as NoteRow | undefined;
  return row ?? null;
}

function createNote(profileId: string, content: string) {
  const normalized = ensureContent(content);
  const total = countNotes(profileId);
  if (total >= MAX_NOTES) {
    throw new Error("Too many notes. Delete some before adding more.");
  }
  const id = nanoid();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `
      INSERT INTO quick_notes (id, profile_id, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(id, profileId, normalized, now, now);
  return getNoteById(profileId, id)!;
}

function deleteNote(profileId: string, noteId: string) {
  const db = getDb();
  const existing = getNoteById(profileId, noteId);
  if (!existing) {
    throw new Error("Note not found.");
  }
  db.prepare(`DELETE FROM quick_notes WHERE id = ? AND profile_id = ?`).run(
    noteId,
    profileId
  );
  return existing;
}

export function runNoteAction(profileId: string, input: NoteActionInput): NotesToolOutput {
  const limit = clampLimit(input.limit);
  switch (input.action) {
    case "show": {
      const notes = listProfileNotes(profileId, limit);
      return { notes, totalCount: countNotes(profileId), limit };
    }
    case "create": {
      if (!input.content) {
        throw new Error("Note content is required.");
      }
      createNote(profileId, input.content);
      const notes = listProfileNotes(profileId, limit);
      return { notes, totalCount: countNotes(profileId), limit };
    }
    case "delete": {
      const noteId =
        input.noteId ||
        (Number.isFinite(input.noteIndex ?? NaN) && (input.noteIndex ?? 0) > 0
          ? resolveNoteIdByIndex(profileId, Number(input.noteIndex))
          : null);
      if (!noteId) {
        throw new Error("Note id or index is required.");
      }
      deleteNote(profileId, noteId);
      const notes = listProfileNotes(profileId, limit);
      return { notes, totalCount: countNotes(profileId), limit };
    }
    default:
      throw new Error("Unsupported note action.");
  }
}

export const __test__ = {
  clampLimit,
  ensureContent,
};
