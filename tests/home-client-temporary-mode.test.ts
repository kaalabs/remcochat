import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";

import type { RemcoChatMessageMetadata } from "../src/domain/chats/types";
import {
  createMemoryDecisionMessage,
  extractMemorizeTextFromMessage,
  resolveTemporaryModeModelId,
} from "../src/app/home-client-temporary-mode";

function makeMessage(
  parts: UIMessage<RemcoChatMessageMetadata>["parts"]
): UIMessage<RemcoChatMessageMetadata> {
  return {
    id: "user-1",
    role: "user",
    metadata: { createdAt: "2026-03-26T10:00:00.000Z" },
    parts,
  };
}

test("extractMemorizeTextFromMessage joins text parts and trims whitespace", () => {
  const message = makeMessage([
    { type: "text", text: "  Remember this  " },
    { type: "text", text: "\nfor later\n" },
  ]);

  assert.equal(
    extractMemorizeTextFromMessage(message),
    "Remember this  \n\nfor later"
  );
});

test("resolveTemporaryModeModelId falls back when the temporary model is invalid", () => {
  const isAllowedModel = (modelId: unknown): modelId is string =>
    modelId === "good-model";

  assert.equal(
    resolveTemporaryModeModelId({
      isAllowedModel,
      profileDefaultModelId: "fallback-model",
      temporaryModelId: "good-model",
    }),
    "good-model"
  );

  assert.equal(
    resolveTemporaryModeModelId({
      isAllowedModel,
      profileDefaultModelId: "fallback-model",
      temporaryModelId: "bad-model",
    }),
    "fallback-model"
  );
});

test("createMemoryDecisionMessage maps confirm and cancel to the persisted prompts", () => {
  assert.equal(createMemoryDecisionMessage("confirm").text, "Confirm memory");
  assert.equal(createMemoryDecisionMessage("cancel").text, "Cancel memory");
  assert.match(
    createMemoryDecisionMessage("confirm").metadata.createdAt,
    /^\d{4}-\d{2}-\d{2}T/
  );
});
