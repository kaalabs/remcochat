import assert from "node:assert/strict";
import test from "node:test";

import {
  adminSetsEqual,
  deriveAdminProviderModelDrafts,
  resolveAdminRouterProviderDraftModelId,
} from "../src/app/admin/admin-client-model-inventory";
import type { ModelsInventoryResponse } from "../src/app/admin/admin-client-api";

function createInventoryFixture(): ModelsInventoryResponse {
  return {
    loadedAt: "2026-03-26T00:00:00Z",
    configPath: "/tmp/config.toml",
    modelsdevVersion: "1.0.0",
    router: { enabled: true, providerId: "openai", modelId: "gpt-5" },
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        modelsdevProviderId: "openai",
        defaultModelId: "gpt-5",
        allowedModelIds: ["gpt-5", "gpt-5-mini"],
        requiredModelIds: ["gpt-5"],
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrl: "https://api.openai.com/v1",
        models: [
          {
            id: "gpt-5",
            label: "GPT-5",
            description: "Primary model",
            npm: null,
            modelType: "chat",
            supported: true,
            capabilities: {
              reasoning: true,
              tools: true,
              temperature: true,
              attachments: true,
              structuredOutput: true,
            },
            contextWindow: 128000,
          },
          {
            id: "gpt-5-mini",
            label: "GPT-5 Mini",
            description: "Smaller model",
            npm: null,
            modelType: "chat",
            supported: true,
            capabilities: {
              reasoning: true,
              tools: true,
              temperature: true,
              attachments: false,
              structuredOutput: true,
            },
            contextWindow: 128000,
          },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        modelsdevProviderId: "anthropic",
        defaultModelId: "claude-opus",
        allowedModelIds: ["claude-opus"],
        requiredModelIds: [],
        apiKeyEnv: "ANTHROPIC_API_KEY",
        baseUrl: "https://api.anthropic.com",
        models: [
          {
            id: "claude-opus",
            label: "Claude Opus",
            description: "Unsupported default",
            npm: null,
            modelType: "chat",
            supported: false,
            capabilities: {
              reasoning: true,
              tools: false,
              temperature: true,
              attachments: false,
              structuredOutput: false,
            },
            contextWindow: 200000,
          },
          {
            id: "claude-sonnet",
            label: "Claude Sonnet",
            description: "Supported fallback",
            npm: null,
            modelType: "chat",
            supported: true,
            capabilities: {
              reasoning: true,
              tools: true,
              temperature: true,
              attachments: true,
              structuredOutput: false,
            },
            contextWindow: 200000,
          },
        ],
      },
      {
        id: "offline",
        name: "Offline",
        modelsdevProviderId: "offline",
        defaultModelId: "unsupported-only",
        allowedModelIds: [],
        requiredModelIds: [],
        apiKeyEnv: "OFFLINE_KEY",
        baseUrl: "http://localhost",
        models: [
          {
            id: "unsupported-only",
            label: "Unsupported Only",
            description: "No supported models",
            npm: null,
            modelType: "chat",
            supported: false,
            capabilities: {
              reasoning: false,
              tools: false,
              temperature: false,
              attachments: false,
              structuredOutput: false,
            },
            contextWindow: 4096,
          },
        ],
      },
    ],
  };
}

test("deriveAdminProviderModelDrafts mirrors inventory defaults into draft state", () => {
  const inventory = createInventoryFixture();

  const drafts = deriveAdminProviderModelDrafts(inventory);

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(drafts.allowedDraftByProviderId).map(([providerId, value]) => [
        providerId,
        Array.from(value).sort(),
      ])
    ),
    {
      anthropic: ["claude-opus"],
      offline: [],
      openai: ["gpt-5", "gpt-5-mini"],
    }
  );
  assert.deepEqual(drafts.defaultDraftByProviderId, {
    anthropic: "claude-opus",
    offline: "unsupported-only",
    openai: "gpt-5",
  });
  assert.deepEqual(drafts.filtersByProviderId, {
    anthropic: { query: "", showAll: false },
    offline: { query: "", showAll: false },
    openai: { query: "", showAll: false },
  });
});

test("resolveAdminRouterProviderDraftModelId prefers the provider default when it is supported", () => {
  const inventory = createInventoryFixture();

  assert.equal(
    resolveAdminRouterProviderDraftModelId({
      inventory,
      providerId: "openai",
    }),
    "gpt-5"
  );
});

test("resolveAdminRouterProviderDraftModelId falls back to the first supported model", () => {
  const inventory = createInventoryFixture();

  assert.equal(
    resolveAdminRouterProviderDraftModelId({
      inventory,
      providerId: "anthropic",
    }),
    "claude-sonnet"
  );
});

test("resolveAdminRouterProviderDraftModelId returns an empty string when no supported model exists", () => {
  const inventory = createInventoryFixture();

  assert.equal(
    resolveAdminRouterProviderDraftModelId({
      inventory,
      providerId: "offline",
    }),
    ""
  );
});

test("adminSetsEqual compares membership instead of insertion order", () => {
  assert.equal(adminSetsEqual(new Set(["a", "b"]), new Set(["b", "a"])), true);
  assert.equal(adminSetsEqual(new Set(["a"]), new Set(["a", "b"])), false);
});
