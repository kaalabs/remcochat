import assert from "node:assert/strict";
import { test } from "node:test";
import { createProviderOptions } from "../src/ai/provider-options";

const reasoningCaps = {
  tools: true,
  reasoning: true,
  temperature: false,
  attachments: false,
  structuredOutput: false,
};

const nonReasoningCaps = {
  tools: true,
  reasoning: false,
  temperature: true,
  attachments: false,
  structuredOutput: false,
};

const reasoningConfig = {
  enabled: true,
  effort: "medium" as const,
  exposeToClient: false,
  openaiSummary: null,
  anthropicBudgetTokens: null,
  googleThinkingBudget: null,
};

test("returns undefined when reasoning disabled", () => {
  const providerOptions = createProviderOptions({
    modelType: "openai_responses",
    providerModelId: "gpt-5.2",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: { ...reasoningConfig, enabled: false },
  });
  assert.equal(providerOptions, undefined);
});

test("returns undefined when model is not reasoning-capable", () => {
  const providerOptions = createProviderOptions({
    modelType: "openai_responses",
    providerModelId: "gpt-5.2",
    capabilities: nonReasoningCaps,
    webToolsEnabled: false,
    reasoning: reasoningConfig,
  });
  assert.equal(providerOptions, undefined);
});

test("openai_responses sets openai.reasoningEffort", () => {
  const providerOptions = createProviderOptions({
    modelType: "openai_responses",
    providerModelId: "gpt-5.2",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: reasoningConfig,
  });
  assert.deepEqual(providerOptions, {
    openai: {
      reasoningEffort: "medium",
    },
  });
});

test("openai_compatible sets openai-compatible.reasoningEffort", () => {
  const providerOptions = createProviderOptions({
    modelType: "openai_compatible",
    providerModelId: "some-model",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: reasoningConfig,
  });
  assert.deepEqual(providerOptions, {
    "openai-compatible": {
      reasoningEffort: "medium",
    },
  });
});

test("xai maps reasoning effort to xai.reasoningEffort", () => {
  const providerOptions = createProviderOptions({
    modelType: "xai",
    providerModelId: "grok-4-fast-reasoning",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: reasoningConfig,
  });
  assert.deepEqual(providerOptions, {
    xai: {
      reasoningEffort: "medium",
    },
  });
});

test("xai omits reasoningEffort for unsupported models", () => {
  const providerOptions = createProviderOptions({
    modelType: "xai",
    providerModelId: "grok-4",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: reasoningConfig,
  });
  assert.equal(providerOptions, undefined);
});

test("xai omits reasoningEffort for unknown models", () => {
  const providerOptions = createProviderOptions({
    modelType: "xai",
    providerModelId: "grok-future-ultra-1",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: reasoningConfig,
  });
  assert.equal(providerOptions, undefined);
});

test("anthropic_messages enables thinking without streaming thoughts", () => {
  const providerOptions = createProviderOptions({
    modelType: "anthropic_messages",
    providerModelId: "claude-opus-4.5",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: reasoningConfig,
  });
  assert.deepEqual(providerOptions, {
    anthropic: {
      sendReasoning: false,
      thinking: { type: "enabled" },
      effort: "medium",
    },
  });
});

test("google_generative_ai enables thinking without includeThoughts", () => {
  const providerOptions = createProviderOptions({
    modelType: "google_generative_ai",
    providerModelId: "gemini-2.5-pro",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: reasoningConfig,
  });
  assert.deepEqual(providerOptions, {
    google: {
      thinkingConfig: {
        thinkingLevel: "medium",
        includeThoughts: false,
      },
    },
  });
});

test("vercel_ai_gateway: openai/* forwards openai reasoning options", () => {
  const providerOptions = createProviderOptions({
    modelType: "vercel_ai_gateway",
    providerModelId: "openai/gpt-5.2-chat",
    capabilities: reasoningCaps,
    webToolsEnabled: true,
    reasoning: { ...reasoningConfig, effort: "high" },
  });
  assert.deepEqual(providerOptions, {
    openai: {
      reasoningEffort: "high",
    },
  });
});

test("vercel_ai_gateway: anthropic/* forwards thinking options", () => {
  const providerOptions = createProviderOptions({
    modelType: "vercel_ai_gateway",
    providerModelId: "anthropic/claude-opus-4.5",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: { ...reasoningConfig, effort: "minimal" },
  });
  assert.deepEqual(providerOptions, {
    anthropic: {
      sendReasoning: false,
      thinking: { type: "enabled" },
      effort: "low",
    },
  });
});

test("vercel_ai_gateway: google/* forwards thinkingConfig options", () => {
  const providerOptions = createProviderOptions({
    modelType: "vercel_ai_gateway",
    providerModelId: "google/gemini-2.5-pro",
    capabilities: reasoningCaps,
    webToolsEnabled: false,
    reasoning: { ...reasoningConfig, effort: "low" },
  });
  assert.deepEqual(providerOptions, {
    google: {
      thinkingConfig: {
        thinkingLevel: "low",
        includeThoughts: false,
      },
    },
  });
});
