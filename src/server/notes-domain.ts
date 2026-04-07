import { normalizeNoteContent } from "@/lib/notes";

const MAX_NOTE_LENGTH = 4000;
const MAX_NOTES = 500;
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;

export function clampNoteLimit(limit?: number) {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
}

export function ensureNoteContent(content: string) {
  const normalized = normalizeNoteContent(content);
  if (!normalized) {
    throw new Error("Note content is required.");
  }
  if (normalized.length > MAX_NOTE_LENGTH) {
    throw new Error("Note is too long.");
  }
  return normalized;
}

export function ensureCanCreateNote(totalNotes: number) {
  if (totalNotes >= MAX_NOTES) {
    throw new Error("Too many notes. Delete some before adding more.");
  }
}
