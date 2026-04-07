import assert from "node:assert/strict";
import test from "node:test";

import {
  canSaveAdminProviderSelection,
  getAdminProviderOptions,
  resolveAdminActiveProviderOption,
} from "../src/app/admin/admin-client-providers";
import { resolveAdminProviderSelectLabel } from "../src/app/admin/admin-client-providers-card";
import type { ProviderSwitcherResponse } from "../src/app/admin/admin-client-api";

function createProviderSwitcherFixture(): ProviderSwitcherResponse {
  return {
    loadedAt: "2026-03-26T00:00:00Z",
    defaultProviderId: "openai",
    activeProviderId: "anthropic",
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        defaultModelId: "gpt-5",
        active: false,
        default: true,
        status: "ready",
        loadError: null,
      },
      {
        id: "anthropic",
        name: "Anthropic",
        defaultModelId: "claude-sonnet",
        active: true,
        default: false,
        status: "degraded",
        loadError: "missing key",
      },
    ],
  };
}

test("getAdminProviderOptions returns providers or an empty list", () => {
  assert.deepEqual(getAdminProviderOptions(null), []);
  assert.equal(getAdminProviderOptions(createProviderSwitcherFixture()).length, 2);
});

test("resolveAdminActiveProviderOption prefers the loaded active provider id", () => {
  const provider = resolveAdminActiveProviderOption({
    activeDraft: "openai",
    providerSwitcher: createProviderSwitcherFixture(),
  });

  assert.equal(provider?.id, "anthropic");
});

test("resolveAdminActiveProviderOption falls back to the current draft when switcher is absent", () => {
  const provider = resolveAdminActiveProviderOption({
    activeDraft: "openai",
    providerSwitcher: null,
  });

  assert.equal(provider, null);
});

test("canSaveAdminProviderSelection only allows changed, non-empty drafts", () => {
  const providerSwitcher = createProviderSwitcherFixture();

  assert.equal(
    canSaveAdminProviderSelection({
      activeDraft: "openai",
      loading: false,
      providerSwitcher,
      saving: false,
    }),
    true
  );
  assert.equal(
    canSaveAdminProviderSelection({
      activeDraft: "anthropic",
      loading: false,
      providerSwitcher,
      saving: false,
    }),
    false
  );
  assert.equal(
    canSaveAdminProviderSelection({
      activeDraft: "   ",
      loading: false,
      providerSwitcher,
      saving: false,
    }),
    false
  );
});

test("resolveAdminProviderSelectLabel uses loading fallback and then selected provider name", () => {
  const providerOptions = createProviderSwitcherFixture().providers;

  assert.equal(
    resolveAdminProviderSelectLabel({
      activeDraft: "openai",
      loading: true,
      providerOptions,
    }),
    null
  );
  assert.equal(
    resolveAdminProviderSelectLabel({
      activeDraft: "openai",
      loading: false,
      providerOptions,
    }),
    "OpenAI"
  );
  assert.equal(
    resolveAdminProviderSelectLabel({
      activeDraft: "missing",
      loading: false,
      providerOptions,
    }),
    "missing"
  );
});
