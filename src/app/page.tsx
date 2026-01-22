import { HomeClient } from "@/app/home-client";
import { createChat, listChats } from "@/server/chats";
import { listProfiles } from "@/server/profiles";
import { isAdminEnabled } from "@/server/admin";
import { getConfig } from "@/server/config";
import packageJson from "../../package.json";

export const dynamic = "force-dynamic";

export default function Home() {
  const config = getConfig();
  const bashToolsLanAccessEnabled = Boolean(
    config.bashTools?.enabled && config.bashTools.access === "lan"
  );

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
      appVersion={String(packageJson.version ?? "")}
      bashToolsLanAccessEnabled={bashToolsLanAccessEnabled}
      initialChats={initialChats}
      initialProfiles={profiles}
    />
  );
}
