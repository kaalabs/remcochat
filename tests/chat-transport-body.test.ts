import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeChatTransportBody } from "../src/lib/chat-transport";

test("mergeChatTransportBody falls back to the current chat request body", () => {
  const merged = mergeChatTransportBody(
    {
      profileId: "profile-1",
      chatId: "chat-1",
      modelId: "gpt-5",
    },
    undefined,
  );

  assert.deepEqual(merged, {
    profileId: "profile-1",
    chatId: "chat-1",
    modelId: "gpt-5",
  });
});

test("mergeChatTransportBody preserves base chat context while layering request-specific fields", () => {
  const merged = mergeChatTransportBody(
    {
      profileId: "profile-1",
      chatId: "chat-1",
      modelId: "gpt-5",
    },
    {
      regenerate: true,
      regenerateMessageId: "assistant-1",
    },
  );

  assert.deepEqual(merged, {
    profileId: "profile-1",
    chatId: "chat-1",
    modelId: "gpt-5",
    regenerate: true,
    regenerateMessageId: "assistant-1",
  });
});
