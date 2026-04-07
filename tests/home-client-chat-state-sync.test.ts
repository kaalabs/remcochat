import assert from "node:assert/strict";
import test from "node:test";

import type { UIMessage } from "ai";

import type { RemcoChatMessageMetadata } from "../src/domain/chats/types";
import {
  normalizeLoadedChatStateResponse,
  shouldSyncPersistedChatState,
  signatureForChatState,
} from "../src/app/home-client-chat-state-sync";

function makeMessage(
  overrides: Partial<UIMessage<RemcoChatMessageMetadata>> = {}
): UIMessage<RemcoChatMessageMetadata> {
  return {
    id: overrides.id ?? "message-1",
    role: overrides.role ?? "user",
    parts: overrides.parts ?? [{ type: "text", text: "Hello" }],
    metadata: overrides.metadata,
  };
}

test("signatureForChatState is stable across variant key ordering", () => {
  const messages = [
    makeMessage({ id: "user-1", role: "user", parts: [{ type: "text", text: "Hi" }] }),
    makeMessage({
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello there" }],
    }),
  ];

  const signatureA = signatureForChatState(messages, {
    b: [makeMessage({ id: "variant-b", parts: [{ type: "text", text: "B" }] })],
    a: [makeMessage({ id: "variant-a", parts: [{ type: "text", text: "A" }] })],
  });
  const signatureB = signatureForChatState(messages, {
    a: [makeMessage({ id: "variant-a", parts: [{ type: "text", text: "A" }] })],
    b: [makeMessage({ id: "variant-b", parts: [{ type: "text", text: "B" }] })],
  });

  assert.equal(signatureA, signatureB);
});

test("normalizeLoadedChatStateResponse falls back to empty arrays and maps", () => {
  assert.deepEqual(normalizeLoadedChatStateResponse(null), {
    messages: [],
    variantsByUserMessageId: {},
  });

  const message = makeMessage({ id: "loaded-message" });
  assert.deepEqual(
    normalizeLoadedChatStateResponse({
      messages: [message],
      variantsByUserMessageId: { user: [message] },
    }),
    {
      messages: [message],
      variantsByUserMessageId: { user: [message] },
    }
  );
});

test("shouldSyncPersistedChatState only syncs ready loaded persisted chats with changed signatures", () => {
  assert.equal(
    shouldSyncPersistedChatState({
      activeChatId: "chat-1",
      activeProfileId: "profile-1",
      error: null,
      isTemporaryChat: false,
      lastSync: null,
      loadedChatId: "chat-1",
      signature: "next",
      status: "ready",
    }),
    true
  );

  assert.equal(
    shouldSyncPersistedChatState({
      activeChatId: "chat-1",
      activeProfileId: "profile-1",
      error: null,
      isTemporaryChat: false,
      lastSync: {
        profileId: "profile-1",
        chatId: "chat-1",
        signature: "next",
      },
      loadedChatId: "chat-1",
      signature: "next",
      status: "ready",
    }),
    false
  );

  assert.equal(
    shouldSyncPersistedChatState({
      activeChatId: "chat-1",
      activeProfileId: "profile-1",
      error: null,
      isTemporaryChat: false,
      lastSync: null,
      loadedChatId: "",
      signature: "next",
      status: "ready",
    }),
    false
  );
});
