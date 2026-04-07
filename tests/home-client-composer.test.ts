import assert from "node:assert/strict";
import test from "node:test";

import type { UIMessage } from "ai";

import type { RemcoChatMessageMetadata } from "../src/domain/chats/types";
import {
  getHomeClientComposerClassName,
  getHomeClientComposerReasoningChoices,
  shouldShowHomeClientComposerReasoningOptions,
  shouldShowHomeClientComposerRegenerate,
  shouldShowHomeClientComposerStop,
} from "../src/app/home-client-composer";

function makeMessage(input: {
  id: string;
  role: UIMessage<RemcoChatMessageMetadata>["role"];
  text?: string;
}): UIMessage<RemcoChatMessageMetadata> {
  return {
    id: input.id,
    role: input.role,
    parts: input.text == null ? [] : [{ type: "text", text: input.text }],
    metadata: { createdAt: "2026-03-26T12:40:00.000Z" },
  };
}

test("shouldShowHomeClientComposerRegenerate only shows for ready chats with prior user messages", () => {
  assert.equal(
    shouldShowHomeClientComposerRegenerate({
      messages: [makeMessage({ id: "user-1", role: "user", text: "Hi" })],
      status: "ready",
    }),
    true
  );

  assert.equal(
    shouldShowHomeClientComposerRegenerate({
      messages: [makeMessage({ id: "assistant-1", role: "assistant", text: "Hi" })],
      status: "ready",
    }),
    false
  );

  assert.equal(
    shouldShowHomeClientComposerRegenerate({
      messages: [makeMessage({ id: "user-1", role: "user", text: "Hi" })],
      status: "streaming",
    }),
    false
  );
});

test("composer helpers preserve stop and reasoning visibility rules", () => {
  assert.equal(shouldShowHomeClientComposerStop("submitted"), true);
  assert.equal(shouldShowHomeClientComposerStop("streaming"), true);
  assert.equal(shouldShowHomeClientComposerStop("ready"), false);

  assert.equal(
    shouldShowHomeClientComposerReasoningOptions({
      reasoningOptions: ["low", "medium"],
      selectedModelSupportsReasoning: true,
    }),
    true
  );

  assert.equal(
    shouldShowHomeClientComposerReasoningOptions({
      reasoningOptions: [],
      selectedModelSupportsReasoning: true,
    }),
    false
  );

  assert.equal(
    shouldShowHomeClientComposerReasoningOptions({
      reasoningOptions: ["low"],
      selectedModelSupportsReasoning: false,
    }),
    false
  );
});

test("composer helper utilities preserve temporary styling and auto reasoning option ordering", () => {
  assert.match(
    getHomeClientComposerClassName(true),
    /border-destructive/
  );
  assert.doesNotMatch(
    getHomeClientComposerClassName(false),
    /border-destructive/
  );

  assert.deepEqual(
    getHomeClientComposerReasoningChoices(["low", "high"]),
    ["auto", "low", "high"]
  );
});
