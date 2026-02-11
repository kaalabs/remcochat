import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProviderOptions,
} from "../src/ai/provider-options";

test("web tools alone do not set providerOptions", () => {
  const options = createProviderOptions({
    modelType: "vercel_ai_gateway",
    providerModelId: "openai/gpt-5.2-pro",
    webToolsEnabled: true,
    capabilities: {
      tools: true,
      reasoning: false,
      temperature: true,
      attachments: false,
      structuredOutput: false,
    },
    reasoning: {
      enabled: true,
      effort: "medium",
      exposeToClient: false,
      openaiSummary: null,
      anthropicBudgetTokens: null,
      googleThinkingBudget: null,
    },
  });

  assert.equal(options, undefined);
});
