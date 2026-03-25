import assert from "node:assert/strict";
import { test } from "node:test";
import type { RemcoChatConfig } from "../src/server/config";
import { buildProviderSwitcher } from "../src/server/provider-switching";

function createTestConfig(): RemcoChatConfig {
  return {
    version: 2,
    defaultProviderId: "openai",
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        defaultModelId: "openai/gpt-5",
        modelsdevProviderId: "openai",
        allowedModelIds: ["openai/gpt-5"],
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      {
        id: "broken",
        name: "Broken Provider",
        defaultModelId: "broken/model-1",
        modelsdevProviderId: "broken",
        allowedModelIds: ["broken/model-1"],
        baseUrl: "https://example.com/v1",
        apiKeyEnv: "BROKEN_API_KEY",
      },
    ],
    skills: null,
    localAccess: null,
    intentRouter: null,
    webTools: null,
    reasoning: {
      enabled: false,
      effort: "minimal",
      exposeToClient: false,
      openaiSummary: null,
      anthropicBudgetTokens: null,
      googleThinkingBudget: null,
    },
    bashTools: null,
    hueGateway: null,
    ovNl: null,
    attachments: {
      enabled: false,
      allowedMediaTypes: [],
      maxFilesPerMessage: 5,
      maxFileSizeBytes: 5_000_000,
      maxTotalSizeBytes: 5_000_000,
      maxExtractedTextChars: 10_000,
      temporaryTtlMs: 60_000,
      sandbox: {
        runtime: "node",
        vcpus: 1,
        timeoutMs: 30_000,
      },
      processing: {
        timeoutMs: 30_000,
        maxStdoutChars: 10_000,
        maxStderrChars: 10_000,
      },
    },
  };
}

test("buildProviderSwitcher returns configured providers when one metadata probe fails", async () => {
  const switcher = await buildProviderSwitcher({
    config: createTestConfig(),
    storedActiveProviderId: "broken",
    timeoutMs: 1000,
    probeProviderMetadata: async (providerId) => {
      if (providerId === "broken") {
        throw new Error("connect ETIMEDOUT");
      }

      return {
        provider: {
          id: "openai",
          name: "OpenAI",
          npm: "@ai-sdk/openai",
        },
        models: {
          "openai/gpt-5": {
            id: "openai/gpt-5",
            name: "GPT-5",
          },
        },
      };
    },
  });

  assert.equal(switcher.defaultProviderId, "openai");
  assert.equal(switcher.activeProviderId, "broken");
  assert.deepEqual(
    switcher.providers.map((provider) => ({
      id: provider.id,
      active: provider.active,
      default: provider.default,
      status: provider.status,
      loadError: provider.loadError,
    })),
    [
      {
        id: "openai",
        active: false,
        default: true,
        status: "ready",
        loadError: null,
      },
      {
        id: "broken",
        active: true,
        default: false,
        status: "degraded",
        loadError: "connect ETIMEDOUT",
      },
    ],
  );
});

test("buildProviderSwitcher falls back to the default provider and flags config metadata mismatches", async () => {
  const switcher = await buildProviderSwitcher({
    config: createTestConfig(),
    storedActiveProviderId: "missing-provider",
    timeoutMs: 1000,
    probeProviderMetadata: async (providerId) => {
      if (providerId === "broken") {
        return {
          provider: {
            id: "broken",
            name: "Broken Provider",
            npm: "@ai-sdk/openai-compatible",
          },
          models: {},
        };
      }

      return {
        provider: {
          id: "openai",
          name: "OpenAI",
          npm: "@ai-sdk/openai",
        },
        models: {
          "openai/gpt-5": {
            id: "openai/gpt-5",
            name: "GPT-5",
          },
        },
      };
    },
  });

  assert.equal(switcher.activeProviderId, "openai");
  assert.equal(
    switcher.providers.find((provider) => provider.id === "openai")?.active,
    true,
  );
  assert.equal(
    switcher.providers.find((provider) => provider.id === "broken")?.loadError,
    'modelsdev catalog missing model "broken/model-1" for provider "broken".',
  );
});
