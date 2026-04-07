"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import {
  fetchAdminLocalAccess,
  fetchAdminWebSearchProvider,
  updateAdminLocalAccess,
  updateAdminWebSearchProvider,
  type LocalAccessResponse,
  type WebSearchProviderResponse,
} from "@/app/admin/admin-client-api";

type UseAdminClientIntegrationsInput = {
  clearSaveNotice: () => void;
  showSaveNotice: (notice: string) => void;
};

export function normalizeAdminWebSearchDraftSelection(
  config: WebSearchProviderResponse
) {
  const selected = String(config.selectedProviderId ?? "").trim();
  const known = config.providers.some((provider) => provider.id === selected);
  return known ? selected : (config.providers[0]?.id ?? selected);
}

export function splitAdminConfigList(value: string): string[] {
  return String(value ?? "")
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function hasAdminLocalAccessDraftChanges(input: {
  commandsDraft: string;
  config: LocalAccessResponse;
  directoriesDraft: string;
  enabledDraft: boolean;
}) {
  const nextCommands = splitAdminConfigList(input.commandsDraft);
  const nextDirectories = splitAdminConfigList(input.directoriesDraft);

  return (
    Boolean(input.enabledDraft) !== Boolean(input.config.enabled)
    || nextCommands.join("\n") !== (input.config.allowedCommands ?? []).join("\n")
    || nextDirectories.join("\n")
      !== (input.config.allowedDirectories ?? []).join("\n")
  );
}

export function useAdminClientIntegrations({
  clearSaveNotice,
  showSaveNotice,
}: UseAdminClientIntegrationsInput) {
  const { t } = useI18n();

  const [webSearchLoading, setWebSearchLoading] = useState(true);
  const [webSearchSaving, setWebSearchSaving] = useState(false);
  const [webSearchError, setWebSearchError] = useState<string | null>(null);
  const [webSearchConfig, setWebSearchConfig] =
    useState<WebSearchProviderResponse | null>(null);
  const [webSearchDraft, setWebSearchDraft] = useState("");

  const [localAccessLoading, setLocalAccessLoading] = useState(true);
  const [localAccessSaving, setLocalAccessSaving] = useState(false);
  const [localAccessError, setLocalAccessError] = useState<string | null>(null);
  const [localAccessConfig, setLocalAccessConfig] =
    useState<LocalAccessResponse | null>(null);
  const [localAccessEnabledDraft, setLocalAccessEnabledDraft] = useState(false);
  const [localAccessCommandsDraft, setLocalAccessCommandsDraft] = useState("");
  const [localAccessDirectoriesDraft, setLocalAccessDirectoriesDraft] =
    useState("");

  const loadWebSearchProvider = useCallback(async () => {
    const data = await fetchAdminWebSearchProvider({
      fallbackErrorMessage: t("error.admin.web_search_provider_load_failed"),
    });
    setWebSearchConfig(data);
    setWebSearchDraft(normalizeAdminWebSearchDraftSelection(data));
  }, [t]);

  const loadLocalAccess = useCallback(async () => {
    const data = await fetchAdminLocalAccess({
      fallbackErrorMessage: t("error.admin.local_access_load_failed"),
    });
    setLocalAccessConfig(data);
    setLocalAccessEnabledDraft(Boolean(data.enabled));
    setLocalAccessCommandsDraft((data.allowedCommands ?? []).join("\n"));
    setLocalAccessDirectoriesDraft((data.allowedDirectories ?? []).join("\n"));
  }, [t]);

  useEffect(() => {
    let canceled = false;
    setWebSearchLoading(true);
    setWebSearchError(null);
    loadWebSearchProvider()
      .catch((err) => {
        if (canceled) return;
        setWebSearchError(
          err instanceof Error
            ? err.message
            : t("error.admin.web_search_provider_load_failed")
        );
      })
      .finally(() => {
        if (canceled) return;
        setWebSearchLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [loadWebSearchProvider, t]);

  useEffect(() => {
    let canceled = false;
    setLocalAccessLoading(true);
    setLocalAccessError(null);
    loadLocalAccess()
      .catch((err) => {
        if (canceled) return;
        setLocalAccessError(
          err instanceof Error
            ? err.message
            : t("error.admin.local_access_load_failed")
        );
      })
      .finally(() => {
        if (canceled) return;
        setLocalAccessLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [loadLocalAccess, t]);

  const saveWebSearchProvider = useCallback(async () => {
    if (!webSearchConfig || !webSearchConfig.enabled || webSearchSaving) return;
    if (webSearchDraft === webSearchConfig.selectedProviderId) return;

    setWebSearchSaving(true);
    setWebSearchError(null);
    clearSaveNotice();
    try {
      await updateAdminWebSearchProvider({
        fallbackErrorMessage: t("error.admin.web_search_provider_update_failed"),
        providerId: webSearchDraft,
      });
      await loadWebSearchProvider();
      showSaveNotice(
        t("admin.web_search.notice.updated", { provider: webSearchDraft })
      );
    } catch (err) {
      setWebSearchError(
        err instanceof Error
          ? err.message
          : t("error.admin.web_search_provider_update_failed")
      );
    } finally {
      setWebSearchSaving(false);
    }
  }, [
    clearSaveNotice,
    loadWebSearchProvider,
    showSaveNotice,
    t,
    webSearchConfig,
    webSearchDraft,
    webSearchSaving,
  ]);

  const resetLocalAccessDraft = useCallback(() => {
    if (!localAccessConfig) return;
    setLocalAccessEnabledDraft(Boolean(localAccessConfig.enabled));
    setLocalAccessCommandsDraft((localAccessConfig.allowedCommands ?? []).join("\n"));
    setLocalAccessDirectoriesDraft(
      (localAccessConfig.allowedDirectories ?? []).join("\n")
    );
  }, [localAccessConfig]);

  const saveLocalAccess = useCallback(async () => {
    if (localAccessSaving) return;
    if (!localAccessConfig) return;

    const nextCommands = splitAdminConfigList(localAccessCommandsDraft);
    const nextDirectories = splitAdminConfigList(localAccessDirectoriesDraft);
    const nextEnabled = Boolean(localAccessEnabledDraft);
    const hasChanges = hasAdminLocalAccessDraftChanges({
      commandsDraft: localAccessCommandsDraft,
      config: localAccessConfig,
      directoriesDraft: localAccessDirectoriesDraft,
      enabledDraft: nextEnabled,
    });
    if (!hasChanges) return;

    setLocalAccessSaving(true);
    setLocalAccessError(null);
    clearSaveNotice();
    try {
      await updateAdminLocalAccess({
        allowedCommands: nextCommands,
        allowedDirectories: nextDirectories,
        enabled: nextEnabled,
        fallbackErrorMessage: t("error.admin.local_access_update_failed"),
      });
      await loadLocalAccess();
      showSaveNotice(t("admin.local_access.notice.updated"));
    } catch (err) {
      setLocalAccessError(
        err instanceof Error
          ? err.message
          : t("error.admin.local_access_update_failed")
      );
    } finally {
      setLocalAccessSaving(false);
    }
  }, [
    clearSaveNotice,
    localAccessCommandsDraft,
    localAccessConfig,
    localAccessDirectoriesDraft,
    localAccessEnabledDraft,
    localAccessSaving,
    loadLocalAccess,
    showSaveNotice,
    t,
  ]);

  return {
    localAccessCommandsDraft,
    localAccessConfig,
    localAccessDirectoriesDraft,
    localAccessEnabledDraft,
    localAccessError,
    localAccessLoading,
    localAccessSaving,
    resetLocalAccessDraft,
    saveLocalAccess,
    saveWebSearchProvider,
    setLocalAccessCommandsDraft,
    setLocalAccessDirectoriesDraft,
    setLocalAccessEnabledDraft,
    setWebSearchDraft,
    webSearchConfig,
    webSearchDraft,
    webSearchError,
    webSearchLoading,
    webSearchSaving,
  };
}
