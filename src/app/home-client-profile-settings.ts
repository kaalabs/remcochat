"use client";

import {
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { Profile } from "@/domain/profiles/types";
import {
  useHomeClientProfileDelete,
  isDeleteProfileConfirmationValid,
} from "@/app/home-client-profile-delete";
import {
  useHomeClientProfileAvatar,
} from "@/app/home-client-profile-avatar";
import {
  useHomeClientProfileMemory,
} from "@/app/home-client-profile-memory";
import {
  useHomeClientProfileSave,
} from "@/app/home-client-profile-save";

type UseHomeClientProfileSettingsInput = {
  activeProfile: Profile | null;
  refreshProfiles: () => Promise<void>;
  setProfiles: Dispatch<SetStateAction<Profile[]>>;
  setUiLanguage: (language: Profile["uiLanguage"]) => void;
  statusReady: boolean;
  t: I18nContextValue["t"];
};

export const isProfileDeleteConfirmationValid =
  isDeleteProfileConfirmationValid;

export function useHomeClientProfileSettings({
  activeProfile,
  refreshProfiles,
  setProfiles,
  setUiLanguage,
  statusReady,
  t,
}: UseHomeClientProfileSettingsInput) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    avatarDraftError,
    avatarDraftFile,
    avatarDraftObjectUrl,
    avatarFileInputRef,
    avatarMaxMb,
    avatarPositionDraft,
    avatarRemoveDraft,
    chooseAvatarFile,
    handleAvatarFileChange,
    removeAvatarDraft,
    setAvatarPositionDraft,
  } = useHomeClientProfileAvatar({
    activeProfile,
    settingsOpen,
    t,
  });

  const {
    profileSettings,
    saveProfileSettings,
  } = useHomeClientProfileSave({
    activeProfile,
    avatarDraftFile,
    avatarPositionDraft,
    avatarRemoveDraft,
    settingsOpen,
    setSettingsOpen,
    setProfiles,
    setUiLanguage,
    t,
  });

  const {
    addMemoryItem,
    deleteMemory,
    memoryItems,
  } = useHomeClientProfileMemory({
    activeProfile,
    settingsOpen,
  });

  const {
    confirmDeleteProfile,
    deleteProfile,
  } = useHomeClientProfileDelete({
    activeProfile,
    onDeleted: refreshProfiles,
    onSettingsClosed: () => {
      setSettingsOpen(false);
    },
    statusReady,
    t,
  });

  return {
    avatarFileInputRef,
    avatarMaxMb,
    addMemoryItem,
    chooseAvatarFile,
    confirmDeleteProfile,
    deleteMemory,
    deleteProfile,
    handleAvatarFileChange,
    profileSettings: {
      avatarMaxMb,
      avatarDraftError,
      avatarDraftFile,
      avatarDraftObjectUrl,
      avatarPositionDraft,
      avatarRemoveDraft,
      error: profileSettings.error,
      memoryEnabledDraft: profileSettings.memoryEnabledDraft,
      memoryItems,
      open: settingsOpen,
      profileInstructionsDraft: profileSettings.profileInstructionsDraft,
      saving: profileSettings.saving,
      setAvatarPositionDraft,
      setMemoryEnabledDraft: profileSettings.setMemoryEnabledDraft,
      setOpen: setSettingsOpen,
      setProfileInstructionsDraft: profileSettings.setProfileInstructionsDraft,
      setUiLanguageDraft: profileSettings.setUiLanguageDraft,
      uiLanguageDraft: profileSettings.uiLanguageDraft,
      value: profileSettings.value,
    },
    removeAvatarDraft,
    saveProfileSettings,
  };
}
