"use client";

import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { AccessibleChat } from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";
import type { Profile } from "@/domain/profiles/types";
import {
  runHomeClientProfileReset,
} from "@/app/home-client-profile-reset";

type ProfileListResponse =
  | { profiles?: Profile[]; error?: string }
  | null;

type UseHomeClientProfileLifecycleInput = {
  setActiveChatId: Dispatch<SetStateAction<string>>;
  setActiveProfileId: Dispatch<SetStateAction<string>>;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  setFolders: Dispatch<SetStateAction<AccessibleChatFolder[]>>;
  setIsTemporaryChat: Dispatch<SetStateAction<boolean>>;
  setProfiles: Dispatch<SetStateAction<Profile[]>>;
};

function appendCreatedProfile(
  profiles: Profile[],
  profile: Profile
): Profile[] {
  return [...profiles, profile];
}

function resolveRefreshedActiveProfileId(profiles: Profile[]): string {
  return profiles[0]?.id ?? "";
}

export function useHomeClientProfileLifecycle({
  setActiveChatId,
  setActiveProfileId,
  setChats,
  setFolders,
  setIsTemporaryChat,
  setProfiles,
}: UseHomeClientProfileLifecycleInput) {
  const applyCreatedProfile = useCallback(
    (profile: Profile) => {
      setProfiles((previous) => appendCreatedProfile(previous, profile));
      runHomeClientProfileReset({
        nextActiveProfileId: profile.id,
        setActiveChatId,
        setActiveProfileId,
        setChats,
        setFolders,
      });
    },
    [
      setActiveChatId,
      setActiveProfileId,
      setChats,
      setFolders,
      setProfiles,
    ]
  );

  const refreshProfiles = useCallback(async () => {
    const response = await fetch("/api/profiles");
    const data = (await response.json().catch(() => null)) as ProfileListResponse;
    const nextProfiles = data?.profiles ?? [];

    setProfiles(nextProfiles);
    runHomeClientProfileReset({
      nextActiveProfileId: resolveRefreshedActiveProfileId(nextProfiles),
      setActiveChatId,
      setActiveProfileId,
      setChats,
      setFolders,
      setIsTemporaryChat,
    });
  }, [
    setActiveChatId,
    setActiveProfileId,
    setChats,
    setFolders,
    setIsTemporaryChat,
    setProfiles,
  ]);

  return {
    applyCreatedProfile,
    refreshProfiles,
  };
}
