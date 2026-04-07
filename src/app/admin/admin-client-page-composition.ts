"use client";

import type { I18nContextValue } from "@/components/i18n-provider";

import {
  resolveAdminClientRouterSectionProps,
  type AdminClientCardsGridProps,
} from "@/app/admin/admin-client-cards";
import {
  useAdminClientControllers,
} from "@/app/admin/admin-client-controllers";
import type { useAdminClientFeedbackState } from "@/app/admin/admin-client-feedback";
import type { AdminClientHeaderProps } from "@/app/admin/admin-client-header";

type AdminClientPageFeedback = Pick<
  ReturnType<typeof useAdminClientFeedbackState>,
  "error" | "saveNotice"
>;

type AdminClientPageModelInventory = Pick<
  ReturnType<typeof useAdminClientControllers>["modelInventory"],
  | "allowedDraftByProviderId"
  | "defaultDraftByProviderId"
  | "defaultModelSavingByProvider"
  | "filtersByProviderId"
  | "inventory"
  | "inventoryError"
  | "inventoryLoading"
  | "modelsError"
  | "modelsSavingByProvider"
  | "resetProviderDefaultDraft"
  | "resetProviderDraft"
  | "routerDraftModelId"
  | "routerDraftProviderId"
  | "routerError"
  | "routerSaving"
  | "saveProviderDefaultDraft"
  | "saveProviderDraft"
  | "saveRouterModel"
  | "setProviderDefaultDraft"
  | "setProviderQuery"
  | "setRouterModelDraft"
  | "setRouterProviderDraft"
  | "toggleAllowedModel"
  | "toggleProviderShowAll"
>;

type AdminClientPageProviders = Pick<
  ReturnType<typeof useAdminClientControllers>["providers"],
  | "activeDraft"
  | "activeProviderOption"
  | "canSave"
  | "loading"
  | "providerOptions"
  | "providerSwitcher"
  | "saving"
  | "setActiveDraft"
>;

type AdminClientPageSkills = Pick<
  ReturnType<typeof useAdminClientControllers>["skills"],
  "skills" | "skillsError" | "skillsLoading" | "skillsSummary"
>;

type AdminClientPageIntegrations = Pick<
  ReturnType<typeof useAdminClientControllers>["integrations"],
  | "localAccessCommandsDraft"
  | "localAccessConfig"
  | "localAccessDirectoriesDraft"
  | "localAccessEnabledDraft"
  | "localAccessError"
  | "localAccessLoading"
  | "localAccessSaving"
  | "resetLocalAccessDraft"
  | "saveLocalAccess"
  | "saveWebSearchProvider"
  | "setLocalAccessCommandsDraft"
  | "setLocalAccessDirectoriesDraft"
  | "setLocalAccessEnabledDraft"
  | "setWebSearchDraft"
  | "webSearchConfig"
  | "webSearchDraft"
  | "webSearchError"
  | "webSearchLoading"
  | "webSearchSaving"
>;

type AdminClientPageMaintenance = Pick<
  ReturnType<typeof useAdminClientControllers>["maintenance"],
  "exportAllData" | "resetAllData" | "resetConfirm" | "resetSaving" | "setResetConfirm"
>;

type AdminClientPageReadiness = Pick<
  ReturnType<typeof useAdminClientControllers>["readiness"],
  | "llmReadinessByProviderId"
  | "readinessRetesting"
  | "retestAllReadiness"
  | "skillReadinessByName"
  | "webSearchReadinessByProviderId"
>;

type AdminClientPageControllers = {
  integrations: AdminClientPageIntegrations;
  maintenance: AdminClientPageMaintenance;
  modelInventory: AdminClientPageModelInventory;
  onSaveActiveProvider: ReturnType<
    typeof useAdminClientControllers
  >["onSaveActiveProvider"];
  providers: AdminClientPageProviders;
  readiness: AdminClientPageReadiness;
  skills: AdminClientPageSkills;
};

type CreateAdminClientPagePropsInput = {
  controllers: AdminClientPageControllers;
  feedback: AdminClientPageFeedback;
  locale: string;
  t: I18nContextValue["t"];
};

export function createAdminClientPageProps({
  controllers,
  feedback,
  locale,
  t,
}: CreateAdminClientPagePropsInput): {
  cardsProps: AdminClientCardsGridProps;
  headerProps: AdminClientHeaderProps;
} {
  const {
    integrations,
    maintenance,
    modelInventory,
    onSaveActiveProvider,
    providers,
    readiness,
    skills,
  } = controllers;

  return {
    headerProps: {
      inventoryLoading: modelInventory.inventoryLoading,
      onRetestAllReadiness: readiness.retestAllReadiness,
      readinessRetesting: readiness.readinessRetesting,
      saveNotice: feedback.saveNotice,
      skillsLoading: skills.skillsLoading,
      t,
    },
    cardsProps: {
      allowedModels: {
        allowedDraftByProviderId: modelInventory.allowedDraftByProviderId,
        defaultDraftByProviderId: modelInventory.defaultDraftByProviderId,
        defaultModelSavingByProvider:
          modelInventory.defaultModelSavingByProvider,
        filtersByProviderId: modelInventory.filtersByProviderId,
        inventory: modelInventory.inventory,
        inventoryError: modelInventory.inventoryError,
        inventoryLoading: modelInventory.inventoryLoading,
        modelsError: modelInventory.modelsError,
        modelsSavingByProvider: modelInventory.modelsSavingByProvider,
        onResetProviderDefaultDraft: modelInventory.resetProviderDefaultDraft,
        onResetProviderDraft: modelInventory.resetProviderDraft,
        onSaveProviderDefaultDraft: modelInventory.saveProviderDefaultDraft,
        onSaveProviderDraft: modelInventory.saveProviderDraft,
        providerSwitcherActiveProviderId:
          providers.providerSwitcher?.activeProviderId ?? null,
        setProviderDefaultDraft: modelInventory.setProviderDefaultDraft,
        setProviderQuery: modelInventory.setProviderQuery,
        toggleAllowedModel: modelInventory.toggleAllowedModel,
        toggleProviderShowAll: modelInventory.toggleProviderShowAll,
      },
      backup: {
        onExport: maintenance.exportAllData,
      },
      localAccess: {
        localAccessCommandsDraft: integrations.localAccessCommandsDraft,
        localAccessConfigPresent: Boolean(integrations.localAccessConfig),
        localAccessDirectoriesDraft: integrations.localAccessDirectoriesDraft,
        localAccessEnabledDraft: integrations.localAccessEnabledDraft,
        localAccessError: integrations.localAccessError,
        localAccessLoading: integrations.localAccessLoading,
        localAccessSaving: integrations.localAccessSaving,
        onReset: integrations.resetLocalAccessDraft,
        onSave: integrations.saveLocalAccess,
        setLocalAccessCommandsDraft: integrations.setLocalAccessCommandsDraft,
        setLocalAccessDirectoriesDraft:
          integrations.setLocalAccessDirectoriesDraft,
        setLocalAccessEnabledDraft: integrations.setLocalAccessEnabledDraft,
      },
      maintenance: {
        onReset: maintenance.resetAllData,
        resetConfirm: maintenance.resetConfirm,
        resetSaving: maintenance.resetSaving,
        setResetConfirm: maintenance.setResetConfirm,
      },
      providers: {
        activeDraft: providers.activeDraft,
        activeProviderOption: providers.activeProviderOption,
        canSave: providers.canSave,
        error: feedback.error,
        llmReadinessByProviderId: readiness.llmReadinessByProviderId,
        loading: providers.loading,
        onSave: onSaveActiveProvider,
        providerOptions: providers.providerOptions,
        saving: providers.saving,
        setActiveDraft: providers.setActiveDraft,
      },
      router: resolveAdminClientRouterSectionProps({
        inventory: modelInventory.inventory,
        inventoryLoading: modelInventory.inventoryLoading,
        llmReadinessByProviderId: readiness.llmReadinessByProviderId,
        onSaveRouterModel: modelInventory.saveRouterModel,
        routerDraftModelId: modelInventory.routerDraftModelId,
        routerDraftProviderId: modelInventory.routerDraftProviderId,
        routerError: modelInventory.routerError,
        routerSaving: modelInventory.routerSaving,
        setRouterModelDraft: modelInventory.setRouterModelDraft,
        setRouterProviderDraft: modelInventory.setRouterProviderDraft,
      }),
      skills: {
        locale,
        skillReadinessByName: readiness.skillReadinessByName,
        skills: skills.skills,
        skillsError: skills.skillsError,
        skillsLoading: skills.skillsLoading,
        skillsSummary: skills.skillsSummary,
      },
      webSearch: {
        onSave: integrations.saveWebSearchProvider,
        setWebSearchDraft: integrations.setWebSearchDraft,
        webSearchConfig: integrations.webSearchConfig,
        webSearchDraft: integrations.webSearchDraft,
        webSearchError: integrations.webSearchError,
        webSearchLoading: integrations.webSearchLoading,
        webSearchReadinessByProviderId:
          readiness.webSearchReadinessByProviderId,
        webSearchSaving: integrations.webSearchSaving,
      },
    },
  };
}
