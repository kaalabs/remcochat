import { notesService } from "@/server/notes-service";

export {
  notesService,
  type NoteActionInput,
} from "@/server/notes-service";

export const listProfileNotes = notesService.listProfileNotes;
export const runNoteAction = notesService.runNoteAction;
