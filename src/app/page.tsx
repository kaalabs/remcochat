import { HomeClient } from "@/app/home-client";
import { createChat, listChats } from "@/server/chats";
import { listProfiles } from "@/server/profiles";
import { isAdminEnabled } from "@/server/admin";
import { getConfig } from "@/server/config";
import { cookies } from "next/headers";
import packageJson from "../../package.json";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = getConfig();
  const bashToolsLanAccessEnabled = Boolean(
    config.bashTools?.enabled && config.bashTools.access === "lan"
  );

  const profiles = listProfiles();
  const defaultProfileId = profiles[0]?.id ?? "";
  const cookieStore = await cookies();
  const storedProfileId = cookieStore.get("remcochat_profile_id")?.value ?? "";
  const initialActiveProfileId = profiles.some((p) => p.id === storedProfileId)
    ? storedProfileId
    : defaultProfileId;

  const chats = initialActiveProfileId ? listChats(initialActiveProfileId) : [];
  const initialChats =
    chats.length > 0 && chats[0]
      ? chats
      : initialActiveProfileId
        ? [createChat({ profileId: initialActiveProfileId })]
        : [];

  return (
    <HomeClient
      adminEnabled={isAdminEnabled()}
      appVersion={String(packageJson.version ?? "")}
      bashToolsLanAccessEnabled={bashToolsLanAccessEnabled}
      initialActiveProfileId={initialActiveProfileId}
      initialChats={initialChats}
      initialProfiles={profiles}
    />
  );
}
