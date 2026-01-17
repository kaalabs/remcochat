import assert from "node:assert/strict";
import { test } from "node:test";
import { createProviderOptionsForWebTools } from "../src/ai/provider-options";

test("returns undefined when web tools disabled", () => {
  const options = createProviderOptionsForWebTools({
    modelType: "vercel_ai_gateway",
    providerModelId: "openai/gpt-5.2-pro",
    webToolsEnabled: false,
  });
  assert.equal(options, undefined);
});

test("does not set providerOptions when web tools enabled", () => {
  const options = createProviderOptionsForWebTools({
    modelType: "openai_responses",
    providerModelId: "gpt-5-nano",
    webToolsEnabled: true,
  });
  assert.equal(options, undefined);
});

test("does not set providerOptions for AI Gateway OpenAI models", () => {
  const options = createProviderOptionsForWebTools({
    modelType: "vercel_ai_gateway",
    providerModelId: "openai/gpt-5.2-pro",
    webToolsEnabled: true,
  });
  assert.equal(options, undefined);
});

test("does not enable OpenAI store for non-OpenAI AI Gateway models", () => {
  const options = createProviderOptionsForWebTools({
    modelType: "vercel_ai_gateway",
    providerModelId: "anthropic/claude-sonnet-4.5",
    webToolsEnabled: true,
  });
  assert.equal(options, undefined);
});
