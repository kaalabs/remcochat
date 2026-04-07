"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import {
  fetchAdminProviderSwitcher,
  updateAdminActiveProvider,
  warmAdminProvidersCatalog,
  type ProviderSwitcherResponse,
} from "@/app/admin/admin-client-api";

type UseAdminClientProvidersInput = {
  clearError: () => void;
  clearSaveNotice: () => void;
  showError: (error: string) => void;
  showSaveNotice: (notice: string) => void;
};

export function getAdminProviderOptions(
  providerSwitcher: ProviderSwitcherResponse | null
) {
  return providerSwitcher?.providers ?? [];
}

export function resolveAdminActiveProviderOption(input: {
  activeDraft: string;
  providerSwitcher: ProviderSwitcherResponse | null;
}) {
  const providerOptions = getAdminProviderOptions(input.providerSwitcher);
  const activeProviderId =
    input.providerSwitcher?.activeProviderId ?? input.activeDraft;

  return (
    providerOptions.find((provider) => provider.id === activeProviderId) ?? null
  );
}

export function canSaveAdminProviderSelection(input: {
  activeDraft: string;
  loading: boolean;
  providerSwitcher: ProviderSwitcherResponse | null;
  saving: boolean;
}) {
  return (
    !input.loading
    && !input.saving
    && input.providerSwitcher != null
    && input.activeDraft.trim().length > 0
    && input.activeDraft !== input.providerSwitcher.activeProviderId
  );
}

export function useAdminClientProviders({
  clearError,
  clearSaveNotice,
  showError,
  showSaveNotice,
}: UseAdminClientProvidersInput) {
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerSwitcher, setProviderSwitcher] =
    useState<ProviderSwitcherResponse | null>(null);
  const [activeDraft, setActiveDraft] = useState("");

  const load = useCallback(async () => {
    const data = await fetchAdminProviderSwitcher({
      fallbackErrorMessage: t("error.admin.provider_switcher_load_failed"),
    });
    setProviderSwitcher(data);
    setActiveDraft(data.activeProviderId);
  }, [t]);

  const warmProvidersCatalog = useCallback(async () => {
    await warmAdminProvidersCatalog({
      fallbackErrorMessage: t("error.admin.providers_load_failed"),
    });
  }, [t]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    clearError();
    clearSaveNotice();
    load()
      .catch((err) => {
        if (canceled) return;
        showError(
          err instanceof Error
            ? err.message
            : t("error.admin.provider_switcher_load_failed")
        );
      })
      .finally(() => {
        if (canceled) return;
        setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [clearError, clearSaveNotice, load, showError, t]);

  const providerOptions = useMemo(() => {
    return getAdminProviderOptions(providerSwitcher);
  }, [providerSwitcher]);

  const activeProviderOption = useMemo(() => {
    return resolveAdminActiveProviderOption({
      activeDraft,
      providerSwitcher,
    });
  }, [activeDraft, providerSwitcher]);

  const canSave = useMemo(() => {
    return canSaveAdminProviderSelection({
      activeDraft,
      loading,
      providerSwitcher,
      saving,
    });
  }, [activeDraft, loading, providerSwitcher, saving]);

  const saveActiveProvider = useCallback(async (options?: {
    afterSave?: () => Promise<void> | void;
  }) => {
    if (!providerSwitcher) return;
    if (!activeDraft) return;
    if (saving) return;

    setSaving(true);
    clearError();
    clearSaveNotice();
    try {
      await updateAdminActiveProvider({
        fallbackErrorMessage: t("error.admin.switch_provider_failed"),
        providerId: activeDraft,
      });
      await load();
      await Promise.all([
        warmProvidersCatalog().catch(() => null),
        Promise.resolve(options?.afterSave?.()).catch(() => null),
      ]);
      showSaveNotice(t("admin.providers.notice.updated"));
    } catch (err) {
      showError(
        err instanceof Error
          ? err.message
          : t("error.admin.switch_provider_failed")
      );
    } finally {
      setSaving(false);
    }
  }, [
    activeDraft,
    clearError,
    clearSaveNotice,
    load,
    providerSwitcher,
    saving,
    showError,
    showSaveNotice,
    t,
    warmProvidersCatalog,
  ]);

  return {
    activeDraft,
    activeProviderOption,
    canSave,
    loading,
    providerOptions,
    providerSwitcher,
    saveActiveProvider,
    saving,
    setActiveDraft,
  };
}
