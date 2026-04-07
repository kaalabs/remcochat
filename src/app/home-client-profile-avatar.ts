"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { Profile } from "@/domain/profiles/types";
import {
  ALLOWED_PROFILE_AVATAR_MEDIA_TYPES,
  MAX_PROFILE_AVATAR_SIZE_BYTES,
} from "@/lib/profile-avatar-constraints";

export type Position = { x: number; y: number };

type ProfileUpdateResponse = {
  profile?: Profile;
  error?: string;
};

type UseHomeClientProfileAvatarInput = {
  activeProfile: Profile | null;
  settingsOpen: boolean;
  t: I18nContextValue["t"];
};

type ProfileAvatarDraftState = {
  avatarDraftError: string | null;
  avatarDraftFile: File | null;
  avatarDraftObjectUrl: string | null;
  avatarPositionDraft: Position;
  avatarRemoveDraft: boolean;
  key: string;
};

export function hasAvatarPositionChanged(
  previous: Position,
  next: Position
): boolean {
  return (
    Math.abs(previous.x - next.x) > 0.1 || Math.abs(previous.y - next.y) > 0.1
  );
}

export function resolveProfileAvatarDraftAction(input: {
  hasExistingAvatar: boolean;
  hasDraftFile: boolean;
  nextPosition: Position;
  previousPosition: Position;
  removeDraft: boolean;
}): "keep" | "remove" | "reposition" | "upload" {
  if (input.removeDraft && input.hasExistingAvatar) return "remove";
  if (input.hasDraftFile) return "upload";
  if (
    input.hasExistingAvatar &&
    !input.removeDraft &&
    hasAvatarPositionChanged(input.previousPosition, input.nextPosition)
  ) {
    return "reposition";
  }
  return "keep";
}

export async function applyProfileAvatarDraft(input: {
  activeProfile: Profile;
  avatarDraftFile: File | null;
  avatarPositionDraft: Position;
  avatarRemoveDraft: boolean;
  baseProfile: Profile;
  t: I18nContextValue["t"];
}): Promise<Profile> {
  const avatarDraftAction = resolveProfileAvatarDraftAction({
    hasDraftFile: Boolean(input.avatarDraftFile),
    hasExistingAvatar: Boolean(input.activeProfile.avatar),
    nextPosition: input.avatarPositionDraft,
    previousPosition: input.activeProfile.avatar?.position ?? { x: 50, y: 50 },
    removeDraft: input.avatarRemoveDraft,
  });

  if (avatarDraftAction === "keep") {
    return input.baseProfile;
  }

  if (avatarDraftAction === "remove") {
    const avatarResponse = await fetch(`/api/profiles/${input.activeProfile.id}/avatar`, {
      method: "DELETE",
    });
    const avatarData = (await avatarResponse.json().catch(() => null)) as
      | ProfileUpdateResponse
      | null;
    if (!avatarResponse.ok || !avatarData?.profile) {
      throw new Error(avatarData?.error || input.t("error.profile.avatar_save_failed"));
    }
    return avatarData.profile;
  }

  if (avatarDraftAction === "upload" && input.avatarDraftFile) {
    const form = new FormData();
    form.set("file", input.avatarDraftFile);
    form.set("posX", String(input.avatarPositionDraft.x));
    form.set("posY", String(input.avatarPositionDraft.y));
    const avatarResponse = await fetch(`/api/profiles/${input.activeProfile.id}/avatar`, {
      method: "PUT",
      body: form,
    });
    const avatarData = (await avatarResponse.json().catch(() => null)) as
      | ProfileUpdateResponse
      | null;
    if (!avatarResponse.ok || !avatarData?.profile) {
      throw new Error(avatarData?.error || input.t("error.profile.avatar_save_failed"));
    }
    return avatarData.profile;
  }

  if (avatarDraftAction === "reposition") {
    const avatarResponse = await fetch(`/api/profiles/${input.activeProfile.id}/avatar`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posX: input.avatarPositionDraft.x,
        posY: input.avatarPositionDraft.y,
      }),
    });
    const avatarData = (await avatarResponse.json().catch(() => null)) as
      | ProfileUpdateResponse
      | null;
    if (!avatarResponse.ok || !avatarData?.profile) {
      throw new Error(avatarData?.error || input.t("error.profile.avatar_save_failed"));
    }
    return avatarData.profile;
  }

  return input.baseProfile;
}

export function useHomeClientProfileAvatar({
  activeProfile,
  settingsOpen,
  t,
}: UseHomeClientProfileAvatarInput) {
  const draftKey = settingsOpen && activeProfile ? activeProfile.id : "";
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [draftState, setDraftState] = useState<ProfileAvatarDraftState | null>(null);

  const currentState = useMemo<ProfileAvatarDraftState>(() => {
    if (draftState && draftState.key === draftKey) {
      return draftState;
    }
    return {
      avatarDraftError: null,
      avatarDraftFile: null,
      avatarDraftObjectUrl: null,
      avatarPositionDraft: activeProfile?.avatar?.position ?? { x: 50, y: 50 },
      avatarRemoveDraft: false,
      key: draftKey,
    };
  }, [activeProfile, draftKey, draftState]);

  useEffect(() => {
    return () => {
      if (!currentState.avatarDraftObjectUrl) return;
      try {
        URL.revokeObjectURL(currentState.avatarDraftObjectUrl);
      } catch {}
    };
  }, [currentState.avatarDraftObjectUrl]);

  useEffect(() => {
    if (avatarFileInputRef.current) {
      avatarFileInputRef.current.value = "";
    }
  }, [draftKey]);

  const avatarMaxMb = Math.max(
    1,
    Math.ceil(MAX_PROFILE_AVATAR_SIZE_BYTES / 1_000_000)
  );

  const chooseAvatarFile = useCallback(() => {
    setDraftState((previous) => ({
      ...(
        previous && previous.key === draftKey
          ? previous
          : {
              avatarDraftError: null,
              avatarDraftFile: null,
              avatarDraftObjectUrl: null,
              avatarPositionDraft: activeProfile?.avatar?.position ?? { x: 50, y: 50 },
              avatarRemoveDraft: false,
              key: draftKey,
            }
      ),
      avatarDraftError: null,
    }));
    avatarFileInputRef.current?.click();
  }, [activeProfile, draftKey]);

  const handleAvatarFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      if (!file) return;

      if (!ALLOWED_PROFILE_AVATAR_MEDIA_TYPES.includes(file.type as never)) {
        setDraftState((previous) => ({
          ...(
            previous && previous.key === draftKey
              ? previous
              : {
                  avatarDraftError: null,
                  avatarDraftFile: null,
                  avatarDraftObjectUrl: null,
                  avatarPositionDraft:
                    activeProfile?.avatar?.position ?? { x: 50, y: 50 },
                  avatarRemoveDraft: false,
                  key: draftKey,
                }
          ),
          avatarDraftError: t("profile.photo.error.unsupported"),
        }));
        event.target.value = "";
        return;
      }

      if (file.size > MAX_PROFILE_AVATAR_SIZE_BYTES) {
        setDraftState((previous) => ({
          ...(
            previous && previous.key === draftKey
              ? previous
              : {
                  avatarDraftError: null,
                  avatarDraftFile: null,
                  avatarDraftObjectUrl: null,
                  avatarPositionDraft:
                    activeProfile?.avatar?.position ?? { x: 50, y: 50 },
                  avatarRemoveDraft: false,
                  key: draftKey,
                }
          ),
          avatarDraftError: t("profile.photo.error.too_large", { mb: avatarMaxMb }),
        }));
        event.target.value = "";
        return;
      }

      setDraftState({
        avatarDraftError: null,
        avatarDraftFile: file,
        avatarDraftObjectUrl: URL.createObjectURL(file),
        avatarPositionDraft: { x: 50, y: 50 },
        avatarRemoveDraft: false,
        key: draftKey,
      });
    },
    [activeProfile, avatarMaxMb, draftKey, t]
  );

  const removeAvatarDraft = useCallback(() => {
    setDraftState({
      avatarDraftError: null,
      avatarDraftFile: null,
      avatarDraftObjectUrl: null,
      avatarPositionDraft: { x: 50, y: 50 },
      avatarRemoveDraft: Boolean(activeProfile?.avatar),
      key: draftKey,
    });
    if (avatarFileInputRef.current) {
      avatarFileInputRef.current.value = "";
    }
  }, [activeProfile?.avatar, draftKey]);

  const setAvatarPositionDraft = useCallback(
    (value: Position | ((previous: Position) => Position)) => {
      setDraftState((previous) => {
        const base =
          previous && previous.key === draftKey
            ? previous
            : {
                avatarDraftError: null,
                avatarDraftFile: null,
                avatarDraftObjectUrl: null,
                avatarPositionDraft:
                  activeProfile?.avatar?.position ?? { x: 50, y: 50 },
                avatarRemoveDraft: false,
                key: draftKey,
              };
        return {
          ...base,
          avatarPositionDraft:
            typeof value === "function"
              ? value(base.avatarPositionDraft)
              : value,
        };
      });
    },
    [activeProfile, draftKey]
  );

  return {
    avatarDraftError: currentState.avatarDraftError,
    avatarDraftFile: currentState.avatarDraftFile,
    avatarDraftObjectUrl: currentState.avatarDraftObjectUrl,
    avatarFileInputRef,
    avatarMaxMb,
    avatarPositionDraft: currentState.avatarPositionDraft,
    avatarRemoveDraft: currentState.avatarRemoveDraft,
    chooseAvatarFile,
    handleAvatarFileChange,
    removeAvatarDraft,
    setAvatarPositionDraft,
  };
}
