"use client";

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { Profile } from "@/domain/profiles/types";
import type { Position } from "@/app/home-client-profile-avatar";
import {
  applyProfileAvatarDraft,
} from "@/app/home-client-profile-avatar";

type ProfileUpdateResponse = {
  profile?: Profile;
  error?: string;
};

type UseHomeClientProfileSaveInput = {
  activeProfile: Profile | null;
  avatarDraftFile: File | null;
  avatarPositionDraft: Position;
  avatarRemoveDraft: boolean;
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setProfiles: Dispatch<SetStateAction<Profile[]>>;
  setUiLanguage: (language: Profile["uiLanguage"]) => void;
  t: I18nContextValue["t"];
};

export function buildProfileSettingsRequestBody(input: {
  customInstructions: string;
  memoryEnabled: boolean;
  uiLanguage: Profile["uiLanguage"];
}) {
  return {
    customInstructions: input.customInstructions,
    memoryEnabled: input.memoryEnabled,
    uiLanguage: input.uiLanguage,
  };
}

export function updateSavedProfile(
  profiles: Profile[],
  nextProfile: Profile
): Profile[] {
  return profiles.map((profile) =>
    profile.id === nextProfile.id ? nextProfile : profile
  );
}

export function useHomeClientProfileSave({
  activeProfile,
  avatarDraftFile,
  avatarPositionDraft,
  avatarRemoveDraft,
  settingsOpen,
  setSettingsOpen,
  setProfiles,
  setUiLanguage,
  t,
}: UseHomeClientProfileSaveInput) {
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [profileInstructionsDraft, setProfileInstructionsDraft] = useState("");
  const [memoryEnabledDraft, setMemoryEnabledDraft] = useState(true);
  const [uiLanguageDraft, setUiLanguageDraft] =
    useState<Profile["uiLanguage"]>("en");

  useEffect(() => {
    if (!settingsOpen) return;
    if (!activeProfile) return;

    setSettingsError(null);
    setProfileInstructionsDraft(activeProfile.customInstructions ?? "");
    setMemoryEnabledDraft(Boolean(activeProfile.memoryEnabled));
    setUiLanguageDraft(activeProfile.uiLanguage ?? "en");
  }, [activeProfile, settingsOpen]);

  const saveProfileSettings = useCallback(async () => {
    if (!activeProfile) return;
    if (settingsSaving) return;

    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch(`/api/profiles/${activeProfile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildProfileSettingsRequestBody({
            customInstructions: profileInstructionsDraft,
            memoryEnabled: memoryEnabledDraft,
            uiLanguage: uiLanguageDraft,
          })
        ),
      });

      const data = (await response.json()) as ProfileUpdateResponse;
      if (!response.ok || !data.profile) {
        throw new Error(data.error || t("error.profile.settings_save_failed"));
      }

      const nextProfile = await applyProfileAvatarDraft({
        activeProfile,
        avatarDraftFile,
        avatarPositionDraft,
        avatarRemoveDraft,
        baseProfile: data.profile,
        t,
      });

      setProfiles((previous) => updateSavedProfile(previous, nextProfile));
      setUiLanguage(nextProfile.uiLanguage);
      setSettingsOpen(false);
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : t("error.profile.settings_save_failed")
      );
    } finally {
      setSettingsSaving(false);
    }
  }, [
    activeProfile,
    avatarDraftFile,
    avatarPositionDraft,
    avatarRemoveDraft,
    memoryEnabledDraft,
    profileInstructionsDraft,
    setProfiles,
    setSettingsOpen,
    setUiLanguage,
    settingsSaving,
    t,
    uiLanguageDraft,
  ]);

  return {
    profileSettings: {
      error: settingsError,
      memoryEnabledDraft,
      profileInstructionsDraft,
      saving: settingsSaving,
      setMemoryEnabledDraft,
      setProfileInstructionsDraft,
      setUiLanguageDraft,
      uiLanguageDraft,
      value: profileInstructionsDraft,
    },
    saveProfileSettings,
  };
}
