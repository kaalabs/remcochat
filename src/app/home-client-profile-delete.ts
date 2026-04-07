"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { Profile } from "@/domain/profiles/types";

type DeleteProfileResponse = {
  ok?: boolean;
  profiles?: Profile[];
  error?: string;
};

type UseHomeClientProfileDeleteInput = {
  activeProfile: Profile | null;
  onDeleted: () => Promise<void>;
  onSettingsClosed: () => void;
  statusReady: boolean;
  t: I18nContextValue["t"];
};

export function isDeleteProfileConfirmationValid(
  raw: string,
  profileName: string
): boolean {
  const value = String(raw ?? "").trim();
  return value === "DELETE" || value === profileName;
}

export function canConfirmDeleteProfile(input: {
  activeProfile: Profile | null;
  confirm: string;
  saving: boolean;
  statusReady: boolean;
}): boolean {
  return (
    input.statusReady &&
    Boolean(input.activeProfile) &&
    !input.saving &&
    isDeleteProfileConfirmationValid(
      input.confirm,
      input.activeProfile?.name ?? ""
    )
  );
}

export function useHomeClientProfileDelete({
  activeProfile,
  onDeleted,
  onSettingsClosed,
  statusReady,
  t,
}: UseHomeClientProfileDeleteInput) {
  const [deleteProfileOpen, setDeleteProfileOpen] = useState(false);
  const [deleteProfileConfirm, setDeleteProfileConfirm] = useState("");
  const [deleteProfileSaving, setDeleteProfileSaving] = useState(false);
  const [deleteProfileError, setDeleteProfileError] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!deleteProfileOpen) return;
    setDeleteProfileError(null);
    setDeleteProfileConfirm("");
  }, [deleteProfileOpen]);

  const confirmDeleteProfile = useCallback(async () => {
    if (!activeProfile) return;
    if (deleteProfileSaving) return;
    if (!statusReady) return;

    const confirm = deleteProfileConfirm.trim();
    if (!confirm) return;

    setDeleteProfileSaving(true);
    setDeleteProfileError(null);
    try {
      const response = await fetch(`/api/profiles/${activeProfile.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      const data = (await response.json().catch(() => null)) as
        | DeleteProfileResponse
        | null;
      if (!response.ok) {
        throw new Error(data?.error || t("error.profile.delete_failed"));
      }

      setDeleteProfileOpen(false);
      onSettingsClosed();
      await onDeleted();
    } catch (err) {
      setDeleteProfileError(
        err instanceof Error ? err.message : t("error.profile.delete_failed")
      );
    } finally {
      setDeleteProfileSaving(false);
    }
  }, [
    activeProfile,
    deleteProfileConfirm,
    deleteProfileSaving,
    onDeleted,
    onSettingsClosed,
    statusReady,
    t,
  ]);

  const canConfirm = canConfirmDeleteProfile({
    activeProfile,
    confirm: deleteProfileConfirm,
    saving: deleteProfileSaving,
    statusReady,
  });

  return {
    confirmDeleteProfile,
    deleteProfile: {
      canConfirm,
      canSubmit: canConfirm,
      confirm: deleteProfileConfirm,
      error: deleteProfileError,
      open: deleteProfileOpen,
      saving: deleteProfileSaving,
      setConfirm: setDeleteProfileConfirm,
      setOpen: setDeleteProfileOpen,
      value: deleteProfileConfirm,
    },
  };
}
