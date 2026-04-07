"use client";

import {
  useCallback,
  useState,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { Profile } from "@/domain/profiles/types";

type ProfileCreateResponse = {
  profile?: Profile;
  error?: string;
};

type CreateProfileRequestBody = {
  name: string;
  defaultModelId: string;
  uiLanguage: Profile["uiLanguage"];
};

type UseHomeClientCreateProfileInput = {
  applyCreatedProfile: (profile: Profile) => void;
  profileDefaultModelId: string;
  t: I18nContextValue["t"];
  uiLanguage: Profile["uiLanguage"];
};

export function resolveCreateProfileRequestBody(input: {
  defaultModelId: string;
  name: string;
  uiLanguage: Profile["uiLanguage"];
}): CreateProfileRequestBody | null {
  const name = input.name.trim();
  if (!name) return null;

  return {
    name,
    defaultModelId: input.defaultModelId,
    uiLanguage: input.uiLanguage,
  };
}

export function useHomeClientCreateProfile({
  applyCreatedProfile,
  profileDefaultModelId,
  t,
  uiLanguage,
}: UseHomeClientCreateProfileInput) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const openCreateProfile = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const saveCreateProfile = useCallback(async () => {
    const requestBody = resolveCreateProfileRequestBody({
      defaultModelId: profileDefaultModelId,
      name: newProfileName,
      uiLanguage,
    });
    if (!requestBody) return;
    if (creating) return;

    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = (await response.json()) as ProfileCreateResponse;
      if (!response.ok || !data.profile) {
        throw new Error(data.error || t("error.profile.create_failed"));
      }

      applyCreatedProfile(data.profile);
      setNewProfileName("");
      setCreateOpen(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : t("error.profile.create_failed")
      );
    } finally {
      setCreating(false);
    }
  }, [
    applyCreatedProfile,
    creating,
    newProfileName,
    profileDefaultModelId,
    t,
    uiLanguage,
  ]);

  return {
    createProfile: {
      error: createError,
      name: newProfileName,
      open: createOpen,
      saving: creating,
      setName: setNewProfileName,
      setOpen: setCreateOpen,
    },
    openCreateProfile,
    saveCreateProfile,
  };
}
