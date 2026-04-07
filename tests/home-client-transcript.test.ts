import assert from "node:assert/strict";
import test from "node:test";

import type { UIMessage } from "ai";

import type { RemcoChatMessageMetadata } from "../src/domain/chats/types";
import {
  buildHomeClientTranscriptMessages,
  shouldSuppressTranscriptAssistantText,
  sortHomeClientAssistantVariants,
  swapHomeClientAssistantVariant,
} from "../src/app/home-client-transcript-helpers";

function makeMessage(input: {
  createdAt?: string;
  id: string;
  metadata?: Partial<RemcoChatMessageMetadata>;
  parts?: UIMessage<RemcoChatMessageMetadata>["parts"];
  role: UIMessage<RemcoChatMessageMetadata>["role"];
  text?: string;
}): UIMessage<RemcoChatMessageMetadata> {
  return {
    id: input.id,
    role: input.role,
    parts:
      input.parts ??
      (input.text == null ? [] : [{ type: "text", text: input.text }]),
    metadata: {
      createdAt: input.createdAt ?? "2026-03-26T12:30:00.000Z",
      ...input.metadata,
    },
  };
}

test("buildHomeClientTranscriptMessages infers assistant turn owners from the latest user turn", () => {
  const transcript = buildHomeClientTranscriptMessages([
    makeMessage({ id: "user-1", role: "user", text: "Hello" }),
    makeMessage({ id: "assistant-1", role: "assistant", text: "Hi" }),
    makeMessage({ id: "assistant-2", role: "assistant", text: "Still here" }),
    makeMessage({ id: "user-2", role: "user", text: "Next" }),
    makeMessage({ id: "assistant-3", role: "assistant", text: "Reply" }),
  ]);

  assert.equal(transcript[1]?.inferredTurnUserMessageId, "user-1");
  assert.equal(transcript[2]?.inferredTurnUserMessageId, "user-1");
  assert.equal(transcript[4]?.inferredTurnUserMessageId, "user-2");
});

test("shouldSuppressTranscriptAssistantText matches the card-driven suppression rules", () => {
  assert.equal(
    shouldSuppressTranscriptAssistantText([
      {
        type: "tool-displayMemoryPrompt",
        toolCallId: "call-1",
        state: "output-available",
        input: {},
        output: {},
      },
    ] as unknown as UIMessage<RemcoChatMessageMetadata>["parts"]),
    true
  );

  assert.equal(
    shouldSuppressTranscriptAssistantText([
      {
        type: "tool-ovNlGateway",
        toolCallId: "call-2",
        state: "output-available",
        input: {},
        output: { kind: "trip" },
      },
    ] as unknown as UIMessage<RemcoChatMessageMetadata>["parts"]),
    true
  );

  assert.equal(
    shouldSuppressTranscriptAssistantText([
      {
        type: "tool-ovNlGateway",
        toolCallId: "call-3",
        state: "output-available",
        input: {},
        output: { kind: "error", error: { code: "unknown" } },
      },
    ] as unknown as UIMessage<RemcoChatMessageMetadata>["parts"]),
    false
  );
});

test("sortHomeClientAssistantVariants preserves chronological assistant paging order", () => {
  const current = makeMessage({
    id: "assistant-current",
    role: "assistant",
    text: "Current",
    createdAt: "2026-03-26T12:20:00.000Z",
  });
  const variants = [
    makeMessage({
      id: "assistant-oldest",
      role: "assistant",
      text: "Oldest",
      createdAt: "2026-03-26T12:10:00.000Z",
    }),
    makeMessage({
      id: "assistant-newest",
      role: "assistant",
      text: "Newest",
      createdAt: "2026-03-26T12:30:00.000Z",
    }),
  ];

  assert.deepEqual(
    sortHomeClientAssistantVariants(current, variants).map((message) => message.id),
    ["assistant-oldest", "assistant-current", "assistant-newest"]
  );
});

test("swapHomeClientAssistantVariant swaps the selected variant into the transcript and rotates the current assistant out", () => {
  const currentAssistant = makeMessage({
    id: "assistant-current",
    role: "assistant",
    text: "Current",
    metadata: { turnUserMessageId: "user-1" },
  });
  const selectedVariant = makeMessage({
    id: "assistant-variant",
    role: "assistant",
    text: "Variant",
    metadata: { turnUserMessageId: "user-1" },
  });
  const untouchedVariant = makeMessage({
    id: "assistant-other",
    role: "assistant",
    text: "Other",
    metadata: { turnUserMessageId: "user-1" },
  });

  const next = swapHomeClientAssistantVariant({
    currentMessage: currentAssistant,
    messages: [
      makeMessage({ id: "user-1", role: "user", text: "Prompt" }),
      currentAssistant,
    ],
    targetId: "assistant-variant",
    turnUserMessageId: "user-1",
    variantsByUserMessageId: {
      "user-1": [selectedVariant, untouchedVariant],
    },
  });

  assert.deepEqual(next.messages.map((message) => message.id), [
    "user-1",
    "assistant-variant",
  ]);
  assert.deepEqual(
    next.variantsByUserMessageId["user-1"]?.map((message) => message.id),
    ["assistant-other", "assistant-current"]
  );
});
