import assert from "node:assert/strict";
import test from "node:test";

import {
  filterAdminInventoryModels,
  resolveAdminRouterCardState,
  toAdminModelPickerOptions,
} from "../src/app/admin/admin-client-models-cards";
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
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        modelsdevProviderId: "openai",
        defaultModelId: "gpt-5",
        allowedModelIds: ["gpt-5"],
        requiredModelIds: [],
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrl: "https://api.openai.com/v1",
        models: [
          {
            id: "gpt-5",
            label: "GPT-5",
            description: "Reasoning model",
            npm: "openai",
            modelType: "chat",
            supported: true,
            capabilities: {
              reasoning: true,
              tools: true,
              temperature: true,
              attachments: true,
              structuredOutput: true,
            },
            contextWindow: 200000,
          },
          {
            id: "gpt-legacy",
            label: "GPT Legacy",
            description: "Unsupported model",
            npm: "openai",
            modelType: "chat",
            supported: false,
            capabilities: {
              reasoning: false,
              tools: false,
              temperature: true,
              attachments: false,
              structuredOutput: false,
            },
            contextWindow: 8000,
          },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        modelsdevProviderId: "anthropic",
        defaultModelId: "claude-sonnet",
        allowedModelIds: ["claude-sonnet"],
        requiredModelIds: [],
        apiKeyEnv: "ANTHROPIC_API_KEY",
        baseUrl: "https://api.anthropic.com",
        models: [
          {
            id: "claude-sonnet",
            label: "Claude Sonnet",
            description: "Balanced model",
            npm: "anthropic",
            modelType: "chat",
            supported: true,
            capabilities: {
              reasoning: true,
              tools: true,
              temperature: false,
              attachments: true,
              structuredOutput: true,
            },
            contextWindow: 100000,
          },
        ],
      },
    ],
  };
}

test("toAdminModelPickerOptions preserves the model metadata used by the picker", () => {
  const [option] = toAdminModelPickerOptions(
    createModelsInventoryFixture().providers[0].models
  );

  assert.deepEqual(option, {
    id: "gpt-5",
    label: "GPT-5",
    description: "Reasoning model",
    modelType: "chat",
    capabilities: {
      reasoning: true,
      tools: true,
      temperature: true,
      attachments: true,
      structuredOutput: true,
    },
    contextWindow: 200000,
  });
});

test("resolveAdminRouterCardState falls back to the configured router provider and filters unsupported models", () => {
  const inventory = createModelsInventoryFixture();

  const state = resolveAdminRouterCardState({
    inventory,
    routerDraftModelId: "claude-sonnet",
    routerDraftProviderId: "",
    routerSaving: false,
  });

  assert.equal(state.providerId, "openai");
  assert.equal(state.provider?.id, "openai");
  assert.deepEqual(
    state.options.map((option) => option.id),
    ["gpt-5"]
  );
  assert.equal(state.canSaveRouter, true);
});

test("resolveAdminRouterCardState blocks save when the draft matches the current router or saving is in progress", () => {
  const inventory = createModelsInventoryFixture();

  assert.equal(
    resolveAdminRouterCardState({
      inventory,
      routerDraftModelId: "gpt-5",
      routerDraftProviderId: "openai",
      routerSaving: false,
    }).canSaveRouter,
    false
  );
  assert.equal(
    resolveAdminRouterCardState({
      inventory,
      routerDraftModelId: "claude-sonnet",
      routerDraftProviderId: "anthropic",
      routerSaving: true,
    }).canSaveRouter,
    false
  );
});

test("filterAdminInventoryModels limits to allowed drafts unless show-all is enabled and still applies search", () => {
  const models = createModelsInventoryFixture().providers[0].models;

  assert.deepEqual(
    filterAdminInventoryModels({
      draft: new Set(["gpt-5"]),
      filter: { query: "", showAll: false },
      models,
    }).map((model) => model.id),
    ["gpt-5"]
  );

  assert.deepEqual(
    filterAdminInventoryModels({
      draft: new Set(["gpt-5"]),
      filter: { query: "legacy", showAll: true },
      models,
    }).map((model) => model.id),
    ["gpt-legacy"]
  );
});
