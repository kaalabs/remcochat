import { getDb } from "@/server/db";
import type { QuickNote } from "@/domain/notes/types";

type NoteRow = {
  id: string;
  profile_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type NotesRepository = {
  countProfileNotes(profileId: string): number;
  listProfileNotes(profileId: string, limit: number): QuickNote[];
  getProfileNoteById(profileId: string, noteId: string): QuickNote | null;
  resolveProfileNoteIdByIndex(profileId: string, index: number): string | null;
  createProfileNote(input: {
    id: string;
    profileId: string;
    content: string;
    now: string;
  }): QuickNote;
  deleteProfileNote(profileId: string, noteId: string): QuickNote;
};

function rowToQuickNote(row: NoteRow): QuickNote {
  return {
    id: row.id,
    profileId: row.profile_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getProfileNoteRowById(profileId: string, noteId: string): NoteRow | null {
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

export function createSqliteNotesRepository(): NotesRepository {
  return {
    countProfileNotes(profileId) {
      const db = getDb();
      const row = db
        .prepare(`SELECT COUNT(1) as count FROM quick_notes WHERE profile_id = ?`)
        .get(profileId) as { count?: number } | undefined;
      return row?.count ?? 0;
    },

    listProfileNotes(profileId, limit) {
      const db = getDb();
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
        .all(profileId, limit) as NoteRow[];
      return rows.map(rowToQuickNote);
    },

    getProfileNoteById(profileId, noteId) {
      const row = getProfileNoteRowById(profileId, noteId);
      return row ? rowToQuickNote(row) : null;
    },

    resolveProfileNoteIdByIndex(profileId, index) {
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
    },

    createProfileNote(input) {
      const db = getDb();
      db.prepare(
        `
          INSERT INTO quick_notes (id, profile_id, content, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `
      ).run(input.id, input.profileId, input.content, input.now, input.now);
      return this.getProfileNoteById(input.profileId, input.id)!;
    },

    deleteProfileNote(profileId, noteId) {
      const db = getDb();
      const existing = this.getProfileNoteById(profileId, noteId);
      if (!existing) {
        throw new Error("Note not found.");
      }
      db.prepare(`DELETE FROM quick_notes WHERE id = ? AND profile_id = ?`).run(
        noteId,
        profileId,
      );
      return existing;
    },
  };
}

export const sqliteNotesRepository = createSqliteNotesRepository();
