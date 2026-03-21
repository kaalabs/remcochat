import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseErrorMessage,
  parseProvidersResponse,
} from "../src/lib/providers-response";

test("parseProvidersResponse accepts valid provider payloads", () => {
  const parsed = parseProvidersResponse({
    defaultProviderId: "openai",
    activeProviderId: "openai",
    webToolsEnabled: true,
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        defaultModelId: "gpt-5.2",
        models: [
          {
            id: "gpt-5.2",
            label: "GPT-5.2",
            type: "openai_responses",
            capabilities: {
              tools: true,
              reasoning: true,
              temperature: false,
              attachments: true,
              structuredOutput: true,
            },
            contextWindow: 200000,
          },
        ],
      },
    ],
  });

  assert.deepEqual(parsed, {
    defaultProviderId: "openai",
    activeProviderId: "openai",
    webToolsEnabled: true,
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        defaultModelId: "gpt-5.2",
        models: [
          {
            id: "gpt-5.2",
            label: "GPT-5.2",
            type: "openai_responses",
            capabilities: {
              tools: true,
              reasoning: true,
              temperature: false,
              attachments: true,
              structuredOutput: true,
            },
            contextWindow: 200000,
          },
        ],
      },
    ],
  });
});

test("parseProvidersResponse rejects error payloads", () => {
  assert.equal(
    parseProvidersResponse({ error: "Failed to load providers." }),
    null
  );
});

test("parseErrorMessage returns backend error text", () => {
  assert.equal(
    parseErrorMessage({ error: "Failed to load providers: boom" }),
    "Failed to load providers: boom"
  );
  assert.equal(parseErrorMessage({ error: "   " }), null);
  assert.equal(parseErrorMessage(null), null);
});
