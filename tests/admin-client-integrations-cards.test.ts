import assert from "node:assert/strict";
import test from "node:test";

import {
  canSaveAdminWebSearchSelection,
  resolveAdminWebSearchProviderLabel,
} from "../src/app/admin/admin-client-integrations-cards";
import type { WebSearchProviderResponse } from "../src/app/admin/admin-client-api";

function createWebSearchConfigFixture(): WebSearchProviderResponse {
  return {
    enabled: true,
    selectedProviderId: "exa",
    providers: [
      { id: "exa", label: "Exa" },
      { id: "brave", label: "Brave Search" },
    ],
  };
}

test("canSaveAdminWebSearchSelection only allows changed enabled drafts while idle", () => {
  const webSearchConfig = createWebSearchConfigFixture();

  assert.equal(
    canSaveAdminWebSearchSelection({
      webSearchConfig,
      webSearchDraft: "brave",
      webSearchLoading: false,
      webSearchSaving: false,
    }),
    true
  );
  assert.equal(
    canSaveAdminWebSearchSelection({
      webSearchConfig,
      webSearchDraft: "exa",
      webSearchLoading: false,
      webSearchSaving: false,
    }),
    false
  );
  assert.equal(
    canSaveAdminWebSearchSelection({
      webSearchConfig: { ...webSearchConfig, enabled: false },
      webSearchDraft: "brave",
      webSearchLoading: false,
      webSearchSaving: false,
    }),
    false
  );
  assert.equal(
    canSaveAdminWebSearchSelection({
      webSearchConfig,
      webSearchDraft: "brave",
      webSearchLoading: true,
      webSearchSaving: false,
    }),
    false
  );
});

test("resolveAdminWebSearchProviderLabel prefers the known label and falls back to draft or placeholder", () => {
  const webSearchConfig = createWebSearchConfigFixture();

  assert.equal(
    resolveAdminWebSearchProviderLabel({
      fallback: "Choose a provider",
      loading: true,
      webSearchConfig,
      webSearchDraft: "exa",
    }),
    null
  );
  assert.equal(
    resolveAdminWebSearchProviderLabel({
      fallback: "Choose a provider",
      loading: false,
      webSearchConfig,
      webSearchDraft: "brave",
    }),
    "Brave Search"
  );
  assert.equal(
    resolveAdminWebSearchProviderLabel({
      fallback: "Choose a provider",
      loading: false,
      webSearchConfig,
      webSearchDraft: "unknown",
    }),
    "unknown"
  );
  assert.equal(
    resolveAdminWebSearchProviderLabel({
      fallback: "Choose a provider",
      loading: false,
      webSearchConfig,
      webSearchDraft: "",
    }),
    "Choose a provider"
  );
});
