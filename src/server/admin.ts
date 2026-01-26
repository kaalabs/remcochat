import { getDb } from "@/server/db";
import { listProfiles } from "@/server/profiles";
import { listChats, loadChatState } from "@/server/chats";
import { listProfileMemory } from "@/server/memory";
import { listProfileLists } from "@/server/lists";
import { listProfileNotes } from "@/server/notes";
import { listProfileAgendaItems } from "@/server/agenda";

export function isAdminEnabled(): boolean {
  const v = String(process.env.REMCOCHAT_ENABLE_ADMIN ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type ExportAllData = {
  schemaVersion: 1;
  exportedAt: string;
  profiles: Array<{
    profile: ReturnType<typeof listProfiles>[number];
    memory: ReturnType<typeof listProfileMemory>;
    lists: ReturnType<typeof listProfileLists>;
    notes: ReturnType<typeof listProfileNotes>;
    agenda: ReturnType<typeof listProfileAgendaItems>;
    chats: Array<
      ReturnType<typeof listChats>[number] & {
        state: ReturnType<typeof loadChatState>;
      }
    >;
  }>;
};

export function exportAllData(): ExportAllData {
  const exportedAt = new Date().toISOString();
  const profiles = listProfiles();

  return {
    schemaVersion: 1,
    exportedAt,
    profiles: profiles.map((profile) => {
      const memory = listProfileMemory(profile.id);
      const lists = listProfileLists(profile.id);
      const notes = listProfileNotes(profile.id, 200);
      const agenda = listProfileAgendaItems(profile.id);
      const chats = listChats(profile.id).map((chat) => ({
        ...chat,
        state: loadChatState(chat.id),
      }));
      return { profile, memory, lists, notes, agenda, chats };
    }),
  };
}

export function resetAllData(): void {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM agenda_item_members;
    DELETE FROM agenda_items;
    DELETE FROM list_members;
    DELETE FROM list_items;
    DELETE FROM lists;
    DELETE FROM quick_notes;
    DELETE FROM message_variants;
    DELETE FROM messages;
    DELETE FROM pending_memory;
    DELETE FROM chats;
    DELETE FROM profile_memory;
    DELETE FROM profiles;
    PRAGMA foreign_keys = ON;
  `);
}
