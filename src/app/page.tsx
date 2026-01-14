import { HomeClient } from "@/app/home-client";
import { createChat, listChats } from "@/server/chats";
import { listProfiles } from "@/server/profiles";
import { isAdminEnabled } from "@/server/admin";

export const dynamic = "force-dynamic";

export default function Home() {
  const profiles = listProfiles();
  const defaultProfileId = profiles[0]?.id ?? "";
  const chats = defaultProfileId ? listChats(defaultProfileId) : [];
  const initialChats =
    chats.length > 0 && chats[0]
      ? chats
      : defaultProfileId
        ? [createChat({ profileId: defaultProfileId })]
        : [];

  return (
    <HomeClient
      adminEnabled={isAdminEnabled()}
      initialChats={initialChats}
      initialProfiles={profiles}
    />
  );
}
