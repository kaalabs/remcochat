import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAdminRouterConfig,
  resolveAdminClientRouterSectionProps,
} from "../src/app/admin/admin-client-cards";
import type { ModelsInventoryResponse } from "../src/app/admin/admin-client-api";

function createModelsInventoryFixture(): ModelsInventoryResponse {
  return {
    loadedAt: "2026-03-26T00:00:00Z",
    configPath: "/repo/remcochat.toml",
    modelsdevVersion: "1.0.0",
    router: {
      enabled: true,
      providerId: "openai",
      modelId: "gpt-5",
    },
    providers: [],
  };
}

test("hasAdminRouterConfig only returns true when router config is present", () => {
  assert.equal(hasAdminRouterConfig(createModelsInventoryFixture()), true);
  assert.equal(
    hasAdminRouterConfig({
      ...createModelsInventoryFixture(),
      router: null,
    }),
    false
  );
  assert.equal(hasAdminRouterConfig(null), false);
});

test("resolveAdminClientRouterSectionProps returns null without router config and preserves props otherwise", () => {
  assert.equal(
    resolveAdminClientRouterSectionProps({
      inventory: null,
      inventoryLoading: false,
      llmReadinessByProviderId: {},
      onSaveRouterModel: () => {},
      routerDraftModelId: "gpt-5",
      routerDraftProviderId: "openai",
      routerError: null,
      routerSaving: false,
      setRouterModelDraft: () => {},
      setRouterProviderDraft: () => {},
    }),
    null
  );

  const inventory = createModelsInventoryFixture();
  const props = resolveAdminClientRouterSectionProps({
    inventory,
    inventoryLoading: true,
    llmReadinessByProviderId: { openai: "untested" },
    onSaveRouterModel: () => {},
    routerDraftModelId: "gpt-5",
    routerDraftProviderId: "openai",
    routerError: "router failed",
    routerSaving: true,
    setRouterModelDraft: () => {},
    setRouterProviderDraft: () => {},
  });

  assert.ok(props);
  assert.equal(props.inventory, inventory);
  assert.equal(props.routerSaving, true);
  assert.equal(props.routerError, "router failed");
});
