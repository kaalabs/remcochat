"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import {
  fetchAdminModelsInventory,
  updateAdminAllowedModels,
  updateAdminDefaultModel,
  updateAdminRouterModel,
  type ModelsInventoryResponse,
} from "@/app/admin/admin-client-api";

export type AdminProviderModelFilter = {
  query: string;
  showAll: boolean;
};

type UseAdminClientModelInventoryInput = {
  clearSaveNotice: () => void;
  showSaveNotice: (notice: string) => void;
};

export function adminSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export function deriveAdminProviderModelDrafts(
  inventory: ModelsInventoryResponse
): {
  allowedDraftByProviderId: Record<string, Set<string>>;
  defaultDraftByProviderId: Record<string, string>;
  filtersByProviderId: Record<string, AdminProviderModelFilter>;
} {
  const allowedDraftByProviderId: Record<string, Set<string>> = {};
  const defaultDraftByProviderId: Record<string, string> = {};
  const filtersByProviderId: Record<string, AdminProviderModelFilter> = {};

  for (const provider of inventory.providers) {
    allowedDraftByProviderId[provider.id] = new Set(provider.allowedModelIds);
    defaultDraftByProviderId[provider.id] = provider.defaultModelId;
    filtersByProviderId[provider.id] = { query: "", showAll: false };
  }

  return {
    allowedDraftByProviderId,
    defaultDraftByProviderId,
    filtersByProviderId,
  };
}

export function resolveAdminRouterProviderDraftModelId(input: {
  inventory: ModelsInventoryResponse;
  providerId: string;
}) {
  const provider = input.inventory.providers.find((item) => item.id === input.providerId);
  const supportedModels = provider?.models.filter((model) => model.supported) ?? [];

  return (
    supportedModels.find((model) => model.id === provider?.defaultModelId)?.id
    ?? supportedModels[0]?.id
    ?? ""
  );
}

export function useAdminClientModelInventory({
  clearSaveNotice,
  showSaveNotice,
}: UseAdminClientModelInventoryInput) {
  const { t } = useI18n();

  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<ModelsInventoryResponse | null>(
    null
  );

  const [modelsSavingByProvider, setModelsSavingByProvider] = useState<
    Record<string, boolean>
  >({});
  const [defaultModelSavingByProvider, setDefaultModelSavingByProvider] =
    useState<Record<string, boolean>>({});
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [routerDraftProviderId, setRouterDraftProviderId] = useState("");
  const [routerDraftModelId, setRouterDraftModelId] = useState("");
  const [routerSaving, setRouterSaving] = useState(false);
  const [routerError, setRouterError] = useState<string | null>(null);

  const [allowedDraftByProviderId, setAllowedDraftByProviderId] = useState<
    Record<string, Set<string>>
  >({});
  const [defaultDraftByProviderId, setDefaultDraftByProviderId] = useState<
    Record<string, string>
  >({});
  const [filtersByProviderId, setFiltersByProviderId] = useState<
    Record<string, AdminProviderModelFilter>
  >({});

  const inventoryRunIdRef = useRef(0);

  const fetchInventory = useCallback(async () => {
    return fetchAdminModelsInventory({
      fallbackErrorMessage: t("error.admin.models_inventory_load_failed"),
    });
  }, [t]);

  const refreshInventory = useCallback(async () => {
    const runId = (inventoryRunIdRef.current += 1);
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const data = await fetchInventory();
      if (inventoryRunIdRef.current !== runId) return;
      setInventory(data);
      setRouterDraftProviderId(data.router?.providerId ?? "");
      setRouterDraftModelId(data.router?.modelId ?? "");
    } catch (err) {
      if (inventoryRunIdRef.current !== runId) return;
      setInventoryError(
        err instanceof Error
          ? err.message
          : t("error.admin.models_inventory_load_failed")
      );
    } finally {
      if (inventoryRunIdRef.current !== runId) return;
      setInventoryLoading(false);
    }
  }, [fetchInventory, t]);

  useEffect(() => {
    refreshInventory().catch(() => {});
    return () => {
      inventoryRunIdRef.current += 1;
    };
  }, [refreshInventory]);

  useEffect(() => {
    if (!inventory) return;
    const drafts = deriveAdminProviderModelDrafts(inventory);
    setAllowedDraftByProviderId(drafts.allowedDraftByProviderId);
    setDefaultDraftByProviderId(drafts.defaultDraftByProviderId);
    setFiltersByProviderId(drafts.filtersByProviderId);
  }, [inventory]);

  const setProviderQuery = useCallback((providerId: string, query: string) => {
    setFiltersByProviderId((prev) => ({
      ...prev,
      [providerId]: { query, showAll: prev[providerId]?.showAll ?? false },
    }));
  }, []);

  const toggleProviderShowAll = useCallback((providerId: string) => {
    setFiltersByProviderId((prev) => ({
      ...prev,
      [providerId]: {
        query: prev[providerId]?.query ?? "",
        showAll: !(prev[providerId]?.showAll ?? false),
      },
    }));
  }, []);

  const toggleAllowedModel = useCallback((providerId: string, modelId: string) => {
    setAllowedDraftByProviderId((prev) => {
      const next = new Set(prev[providerId] ?? []);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return { ...prev, [providerId]: next };
    });
  }, []);

  const setProviderDefaultDraft = useCallback(
    (providerId: string, modelId: string) => {
      setDefaultDraftByProviderId((prev) => ({ ...prev, [providerId]: modelId }));
    },
    []
  );

  const resetProviderDraft = useCallback(
    (providerId: string) => {
      if (!inventory) return;
      const provider = inventory.providers.find((item) => item.id === providerId);
      if (!provider) return;
      setAllowedDraftByProviderId((prev) => ({
        ...prev,
        [providerId]: new Set(provider.allowedModelIds),
      }));
    },
    [inventory]
  );

  const resetProviderDefaultDraft = useCallback(
    (providerId: string) => {
      if (!inventory) return;
      const provider = inventory.providers.find((item) => item.id === providerId);
      if (!provider) return;
      setDefaultDraftByProviderId((prev) => ({
        ...prev,
        [providerId]: provider.defaultModelId,
      }));
    },
    [inventory]
  );

  const saveProviderDraft = useCallback(
    async (providerId: string) => {
      if (!inventory) return;
      const draft = allowedDraftByProviderId[providerId];
      if (!draft) return;
      if (modelsSavingByProvider[providerId]) return;

      setModelsSavingByProvider((prev) => ({ ...prev, [providerId]: true }));
      setModelsError(null);
      clearSaveNotice();
      try {
        await updateAdminAllowedModels({
          allowedModelIds: Array.from(draft),
          fallbackErrorMessage: t("error.admin.allowed_models_update_failed"),
          providerId,
        });
        await refreshInventory();
        showSaveNotice(t("admin.models.notice.allowed_updated", { providerId }));
      } catch (err) {
        setModelsError(
          err instanceof Error
            ? err.message
            : t("error.admin.allowed_models_update_failed")
        );
      } finally {
        setModelsSavingByProvider((prev) => ({ ...prev, [providerId]: false }));
      }
    },
    [
      allowedDraftByProviderId,
      clearSaveNotice,
      inventory,
      modelsSavingByProvider,
      refreshInventory,
      showSaveNotice,
      t,
    ]
  );

  const saveProviderDefaultDraft = useCallback(
    async (providerId: string) => {
      if (!inventory) return;
      const provider = inventory.providers.find((item) => item.id === providerId);
      if (!provider) return;

      const draftDefault = String(defaultDraftByProviderId[providerId] ?? "").trim();
      if (!draftDefault) return;
      if (defaultModelSavingByProvider[providerId]) return;

      const allowedDraft =
        allowedDraftByProviderId[providerId] ?? new Set(provider.allowedModelIds);
      const hasAllowedChanges = !adminSetsEqual(
        allowedDraft,
        new Set(provider.allowedModelIds)
      );
      if (hasAllowedChanges) {
        setModelsError(
          t("admin.models.error.unsaved_allowed_changes", { providerId })
        );
        return;
      }

      setDefaultModelSavingByProvider((prev) => ({
        ...prev,
        [providerId]: true,
      }));
      setModelsError(null);
      clearSaveNotice();
      try {
        await updateAdminDefaultModel({
          defaultModelId: draftDefault,
          fallbackErrorMessage: t("error.admin.default_model_update_failed"),
          providerId,
        });
        await refreshInventory();
        showSaveNotice(t("admin.models.notice.default_updated", { providerId }));
      } catch (err) {
        setModelsError(
          err instanceof Error
            ? err.message
            : t("error.admin.default_model_update_failed")
        );
      } finally {
        setDefaultModelSavingByProvider((prev) => ({
          ...prev,
          [providerId]: false,
        }));
      }
    },
    [
      allowedDraftByProviderId,
      clearSaveNotice,
      defaultDraftByProviderId,
      defaultModelSavingByProvider,
      inventory,
      refreshInventory,
      showSaveNotice,
      t,
    ]
  );

  const setRouterProviderDraft = useCallback(
    (providerId: string) => {
      setRouterDraftProviderId(providerId);
      if (!inventory) {
        setRouterDraftModelId("");
        return;
      }
      setRouterDraftModelId(
        resolveAdminRouterProviderDraftModelId({
          inventory,
          providerId,
        })
      );
    },
    [inventory]
  );

  const setRouterModelDraft = useCallback((modelId: string) => {
    setRouterDraftModelId(modelId);
  }, []);

  const saveRouterModel = useCallback(async () => {
    if (!inventory?.router) return;
    const providerId = String(
      routerDraftProviderId || inventory.router.providerId || ""
    ).trim();
    if (!providerId) return;
    if (!routerDraftModelId) return;
    if (routerSaving) return;

    setRouterSaving(true);
    setRouterError(null);
    clearSaveNotice();
    try {
      await updateAdminRouterModel({
        fallbackErrorMessage: t("error.admin.router_model_update_failed"),
        modelId: routerDraftModelId,
        providerId,
      });
      await refreshInventory();
      showSaveNotice(t("admin.router.notice.updated"));
    } catch (err) {
      setRouterError(
        err instanceof Error
          ? err.message
          : t("error.admin.router_model_update_failed")
      );
    } finally {
      setRouterSaving(false);
    }
  }, [
    clearSaveNotice,
    inventory,
    refreshInventory,
    routerDraftModelId,
    routerDraftProviderId,
    routerSaving,
    showSaveNotice,
    t,
  ]);

  return {
    allowedDraftByProviderId,
    defaultDraftByProviderId,
    defaultModelSavingByProvider,
    filtersByProviderId,
    inventory,
    inventoryError,
    inventoryLoading,
    modelsError,
    modelsSavingByProvider,
    refreshInventory,
    resetProviderDefaultDraft,
    resetProviderDraft,
    routerDraftModelId,
    routerDraftProviderId,
    routerError,
    routerSaving,
    saveProviderDefaultDraft,
    saveProviderDraft,
    saveRouterModel,
    setProviderDefaultDraft,
    setProviderQuery,
    setRouterModelDraft,
    setRouterProviderDraft,
    toggleAllowedModel,
    toggleProviderShowAll,
  };
}
