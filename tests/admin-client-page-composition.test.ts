import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminClientPageProps,
} from "../src/app/admin/admin-client-page-composition";
import type { ModelsInventoryResponse } from "../src/app/admin/admin-client-api";

function createModelsInventoryFixture(
  overrides?: Partial<ModelsInventoryResponse>
): ModelsInventoryResponse {
  return {
    configPath: "/repo/remcochat.toml",
    loadedAt: "2026-03-26T00:00:00Z",
    modelsdevVersion: "1.0.0",
    providers: [],
    router: {
      enabled: true,
      modelId: "gpt-5",
      providerId: "openai",
    },
    ...overrides,
  };
}

test("createAdminClientPageProps combines feedback, controllers, and i18n into admin page props", () => {
  const onSaveActiveProvider = () => {};
  const t = ((key: string) => key) as (key: string) => string;

  const props = createAdminClientPageProps({
    controllers: {
      integrations: {
        localAccessCommandsDraft: "git\nnode",
        localAccessConfig: {
          allowedCommands: ["git", "node"],
          allowedDirectories: ["/tmp"],
          configured: true,
          enabled: true,
        },
        localAccessDirectoriesDraft: "/tmp",
        localAccessEnabledDraft: true,
        localAccessError: null,
        localAccessLoading: false,
        localAccessSaving: false,
        resetLocalAccessDraft: () => {},
        saveLocalAccess: () => Promise.resolve(),
        saveWebSearchProvider: () => Promise.resolve(),
        setLocalAccessCommandsDraft: () => {},
        setLocalAccessDirectoriesDraft: () => {},
        setLocalAccessEnabledDraft: () => {},
        setWebSearchDraft: () => {},
        webSearchConfig: null,
        webSearchDraft: "exa",
        webSearchError: null,
        webSearchLoading: false,
        webSearchSaving: false,
      },
      maintenance: {
        exportAllData: () => {},
        resetAllData: () => Promise.resolve(),
        resetConfirm: "RESET",
        resetSaving: false,
        setResetConfirm: () => {},
      },
      modelInventory: {
        allowedDraftByProviderId: {},
        defaultDraftByProviderId: {},
        defaultModelSavingByProvider: {},
        filtersByProviderId: {},
        inventory: createModelsInventoryFixture(),
        inventoryError: null,
        inventoryLoading: false,
        modelsError: null,
        modelsSavingByProvider: {},
        resetProviderDefaultDraft: () => {},
        resetProviderDraft: () => {},
        routerDraftModelId: "gpt-5",
        routerDraftProviderId: "openai",
        routerError: null,
        routerSaving: false,
        saveProviderDefaultDraft: () => Promise.resolve(),
        saveProviderDraft: () => Promise.resolve(),
        saveRouterModel: () => Promise.resolve(),
        setProviderDefaultDraft: () => {},
        setProviderQuery: () => {},
        setRouterModelDraft: () => {},
        setRouterProviderDraft: () => {},
        toggleAllowedModel: () => {},
        toggleProviderShowAll: () => {},
      },
      onSaveActiveProvider,
      providers: {
        activeDraft: "openai",
        activeProviderOption: null,
        canSave: true,
        loading: false,
        providerOptions: [],
        providerSwitcher: {
          activeProviderId: "openai",
          defaultProviderId: "openai",
          loadedAt: "2026-03-26T00:00:00Z",
          providers: [],
        },
        saving: false,
        setActiveDraft: () => {},
      },
      readiness: {
        llmReadinessByProviderId: { openai: "passed" },
        readinessRetesting: false,
        retestAllReadiness: () => Promise.resolve(),
        skillReadinessByName: {},
        webSearchReadinessByProviderId: {},
      },
      skills: {
        skills: null,
        skillsError: null,
        skillsLoading: true,
        skillsSummary: null,
      },
    },
    feedback: {
      error: "provider failed",
      saveNotice: "saved",
    },
    locale: "en",
    t,
  });

  assert.equal(props.headerProps.saveNotice, "saved");
  assert.equal(props.headerProps.t, t);
  assert.equal(props.cardsProps.providers.error, "provider failed");
  assert.equal(props.cardsProps.providers.onSave, onSaveActiveProvider);
  assert.equal(props.cardsProps.skills.locale, "en");
  assert.equal(props.cardsProps.localAccess.localAccessConfigPresent, true);
  assert.ok(props.cardsProps.router);
  assert.equal(props.cardsProps.router.inventory.router?.providerId, "openai");
});

test("createAdminClientPageProps omits the router card when the inventory has no router config", () => {
  const props = createAdminClientPageProps({
    controllers: {
      integrations: {
        localAccessCommandsDraft: "",
        localAccessConfig: null,
        localAccessDirectoriesDraft: "",
        localAccessEnabledDraft: false,
        localAccessError: null,
        localAccessLoading: false,
        localAccessSaving: false,
        resetLocalAccessDraft: () => {},
        saveLocalAccess: () => Promise.resolve(),
        saveWebSearchProvider: () => Promise.resolve(),
        setLocalAccessCommandsDraft: () => {},
        setLocalAccessDirectoriesDraft: () => {},
        setLocalAccessEnabledDraft: () => {},
        setWebSearchDraft: () => {},
        webSearchConfig: null,
        webSearchDraft: "",
        webSearchError: null,
        webSearchLoading: false,
        webSearchSaving: false,
      },
      maintenance: {
        exportAllData: () => {},
        resetAllData: () => Promise.resolve(),
        resetConfirm: "",
        resetSaving: false,
        setResetConfirm: () => {},
      },
      modelInventory: {
        allowedDraftByProviderId: {},
        defaultDraftByProviderId: {},
        defaultModelSavingByProvider: {},
        filtersByProviderId: {},
        inventory: createModelsInventoryFixture({ router: null }),
        inventoryError: null,
        inventoryLoading: false,
        modelsError: null,
        modelsSavingByProvider: {},
        resetProviderDefaultDraft: () => {},
        resetProviderDraft: () => {},
        routerDraftModelId: "gpt-5",
        routerDraftProviderId: "openai",
        routerError: null,
        routerSaving: false,
        saveProviderDefaultDraft: () => Promise.resolve(),
        saveProviderDraft: () => Promise.resolve(),
        saveRouterModel: () => Promise.resolve(),
        setProviderDefaultDraft: () => {},
        setProviderQuery: () => {},
        setRouterModelDraft: () => {},
        setRouterProviderDraft: () => {},
        toggleAllowedModel: () => {},
        toggleProviderShowAll: () => {},
      },
      onSaveActiveProvider: () => {},
      providers: {
        activeDraft: "openai",
        activeProviderOption: null,
        canSave: true,
        loading: false,
        providerOptions: [],
        providerSwitcher: null,
        saving: false,
        setActiveDraft: () => {},
      },
      readiness: {
        llmReadinessByProviderId: {},
        readinessRetesting: false,
        retestAllReadiness: () => Promise.resolve(),
        skillReadinessByName: {},
        webSearchReadinessByProviderId: {},
      },
      skills: {
        skills: null,
        skillsError: null,
        skillsLoading: false,
        skillsSummary: null,
      },
    },
    feedback: {
      error: null,
      saveNotice: null,
    },
    locale: "en",
    t: ((key: string) => key) as (key: string) => string,
  });

  assert.equal(props.cardsProps.router, null);
});
