import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminClientSaveActiveProviderAction,
  createAdminClientReadinessInput,
} from "../src/app/admin/admin-client-controllers";

test("createAdminClientReadinessInput preserves the extracted admin controller dependencies", () => {
  const buildAdminHeaders = () => ({ "x-remcochat-admin-token": "secret" });
  const providerSwitcher = {
    activeProviderId: "openai",
    defaultProviderId: "openai",
    loadedAt: "2026-03-26T00:00:00Z",
    providers: [],
  };
  const refreshInventory = async () => {};
  const refreshSkills = async () => {};
  const skills = { enabled: true, skills: [] };
  const webSearchConfig = {
    enabled: true,
    providers: [],
    selectedProviderId: "exa",
  };

  const input = createAdminClientReadinessInput({
    buildAdminHeaders,
    integrations: { webSearchConfig },
    modelInventory: { refreshInventory },
    providers: { providerSwitcher },
    skills: { refreshSkills, skills },
  });

  assert.equal(input.buildAdminHeaders, buildAdminHeaders);
  assert.equal(input.providerSwitcher, providerSwitcher);
  assert.equal(input.refreshInventory, refreshInventory);
  assert.equal(input.refreshSkills, refreshSkills);
  assert.equal(input.skills, skills);
  assert.equal(input.webSearchConfig, webSearchConfig);
});

test("createAdminClientSaveActiveProviderAction resets readiness auto-start and refreshes inventory after save", async () => {
  const calls: string[] = [];
  const action = createAdminClientSaveActiveProviderAction({
    refreshInventory: async () => {
      calls.push("refreshInventory");
      return null;
    },
    resetLlmAutoStart: () => {
      calls.push("resetLlmAutoStart");
    },
    saveActiveProvider: async ({ afterSave }) => {
      calls.push("saveActiveProvider");
      await afterSave();
    },
  });

  await action();

  assert.deepEqual(calls, [
    "saveActiveProvider",
    "resetLlmAutoStart",
    "refreshInventory",
  ]);
});

test("createAdminClientSaveActiveProviderAction swallows refreshInventory failures inside afterSave", async () => {
  const action = createAdminClientSaveActiveProviderAction({
    refreshInventory: async () => {
      throw new Error("inventory failed");
    },
    resetLlmAutoStart: () => {},
    saveActiveProvider: async ({ afterSave }) => {
      await afterSave();
    },
  });

  await assert.doesNotReject(async () => {
    await Promise.resolve(action());
  });
});
