"use client";

import { useCallback, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import { resetAdminData } from "@/app/admin/admin-client-api";

type UseAdminClientMaintenanceInput = {
  clearError: () => void;
  clearSaveNotice: () => void;
  showError: (error: string) => void;
  showSaveNotice: (notice: string) => void;
};

export function splitAdminDangerDescription(description: string) {
  return String(description ?? "").split("RESET");
}

export function canAdminResetData(input: {
  resetConfirm: string;
  resetSaving: boolean;
}) {
  return !input.resetSaving && input.resetConfirm === "RESET";
}

export function useAdminClientMaintenance({
  clearError,
  clearSaveNotice,
  showError,
  showSaveNotice,
}: UseAdminClientMaintenanceInput) {
  const { t } = useI18n();
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetSaving, setResetSaving] = useState(false);

  const exportAllData = useCallback(() => {
    const link = document.createElement("a");
    link.href = "/api/admin/export";
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);

  const resetAllData = useCallback(async () => {
    if (resetSaving) return;
    if (resetConfirm !== "RESET") return;

    setResetSaving(true);
    clearError();
    clearSaveNotice();
    try {
      await resetAdminData({
        confirm: "RESET",
        fallbackErrorMessage: t("error.admin.reset_failed"),
      });
      setResetConfirm("");
      showSaveNotice(t("admin.reset.notice.completed"));
    } catch (err) {
      showError(
        err instanceof Error ? err.message : t("error.admin.reset_failed")
      );
    } finally {
      setResetSaving(false);
    }
  }, [
    clearError,
    clearSaveNotice,
    resetConfirm,
    resetSaving,
    showError,
    showSaveNotice,
    t,
  ]);

  return {
    exportAllData,
    resetAllData,
    resetConfirm,
    resetSaving,
    setResetConfirm,
  };
}
