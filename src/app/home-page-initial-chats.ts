import type { AccessibleChat } from "@/domain/chats/types";
import {
  createChat,
  getChatForViewer,
  listAccessibleChats,
} from "@/server/chats";

export function getHomePageInitialChats(profileId: string): AccessibleChat[] {
  if (!profileId) return [];

  const chats = listAccessibleChats(profileId);
  if (chats.length > 0) return chats;

  const created = createChat({ profileId });
  return [getChatForViewer(profileId, created.id)];
}
