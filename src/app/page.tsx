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
  // The admin token gates LAN access for any "access=lan" server-side tool (bash, hue, ov_nl, ...).
  // The client must send `x-remcochat-admin-token` for these to be enabled on non-localhost requests.
  const lanAdminAccessEnabled = Boolean(
    (config.bashTools?.enabled && config.bashTools.access === "lan") ||
      (config.hueGateway?.enabled && config.hueGateway.access === "lan") ||
      (config.ovNl?.enabled && config.ovNl.access === "lan")
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
      lanAdminAccessEnabled={lanAdminAccessEnabled}
      initialActiveProfileId={initialActiveProfileId}
      initialChats={initialChats}
      initialProfiles={profiles}
    />
  );
}
