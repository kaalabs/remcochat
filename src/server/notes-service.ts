import { nanoid } from "nanoid";
import type { NotesToolOutput, QuickNote } from "@/domain/notes/types";
import {
  clampNoteLimit,
  ensureCanCreateNote,
  ensureNoteContent,
} from "@/server/notes-domain";
import {
  sqliteNotesRepository,
  type NotesRepository,
} from "@/server/notes-repository";

export type NoteActionInput = {
  action: "show" | "create" | "delete";
  content?: string;
  noteId?: string;
  noteIndex?: number;
  limit?: number;
};

export type NotesService = {
  listProfileNotes(profileId: string, limit?: number): QuickNote[];
  runNoteAction(profileId: string, input: NoteActionInput): NotesToolOutput;
};

export function createNotesService(repository: NotesRepository): NotesService {
  function listProfileNotes(profileId: string, limit?: number) {
    return repository.listProfileNotes(profileId, clampNoteLimit(limit));
  }

  function listNotesSnapshot(profileId: string, limit?: number): NotesToolOutput {
    const safeLimit = clampNoteLimit(limit);
    return {
      notes: repository.listProfileNotes(profileId, safeLimit),
      totalCount: repository.countProfileNotes(profileId),
      limit: safeLimit,
    };
  }

  return {
    listProfileNotes,

    runNoteAction(profileId, input) {
      switch (input.action) {
        case "show":
          return listNotesSnapshot(profileId, input.limit);
        case "create": {
          if (!input.content) {
            throw new Error("Note content is required.");
          }
          ensureCanCreateNote(repository.countProfileNotes(profileId));
          repository.createProfileNote({
            id: nanoid(),
            profileId,
            content: ensureNoteContent(input.content),
            now: new Date().toISOString(),
          });
          return listNotesSnapshot(profileId, input.limit);
        }
        case "delete": {
          const noteId =
            input.noteId ||
            (Number.isFinite(input.noteIndex ?? NaN) && (input.noteIndex ?? 0) > 0
              ? repository.resolveProfileNoteIdByIndex(
                  profileId,
                  Number(input.noteIndex),
                )
              : null);
          if (!noteId) {
            throw new Error("Note id or index is required.");
          }
          repository.deleteProfileNote(profileId, noteId);
          return listNotesSnapshot(profileId, input.limit);
        }
        default:
          throw new Error("Unsupported note action.");
      }
    },
  };
}

export const notesService = createNotesService(sqliteNotesRepository);
export const listProfileNotes = notesService.listProfileNotes;
export const runNoteAction = notesService.runNoteAction;

export const __test__ = {
  clampLimit: clampNoteLimit,
  ensureContent: ensureNoteContent,
};
