"use client";

import { useI18n } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";
import type { Profile } from "@/domain/profiles/types";
import {
  useHomeClientPageComposition,
} from "@/app/home-client-page-composition";
import { HomeClientRootShell } from "@/app/home-client-root-shell";

export type HomeClientProps = {
  adminEnabled: boolean;
  appVersion: string;
  lanAdminAccessEnabled: boolean;
  initialActiveProfileId: string;
  initialProfiles: Profile[];
  initialChats: AccessibleChat[];
};

export function HomeClient({
  adminEnabled,
  appVersion,
  lanAdminAccessEnabled,
  initialActiveProfileId,
  initialProfiles,
  initialChats,
}: HomeClientProps) {
  const { setUiLanguage, t, uiLanguage } = useI18n();

  const rootShellProps = useHomeClientPageComposition({
    adminEnabled,
    appVersion,
    initialActiveProfileId,
    initialChats,
    initialProfiles,
    lanAdminAccessEnabled,
    setUiLanguage,
    t,
    uiLanguage,
  });

  return <HomeClientRootShell {...rootShellProps} />;
}
