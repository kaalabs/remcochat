import assert from "node:assert/strict";
import test from "node:test";

import type { UIMessage } from "ai";

import type { RemcoChatMessageMetadata } from "../src/domain/chats/types";
import type { TaskListOverview } from "../src/domain/lists/types";
import {
  buildHomeClientChatRequestBody,
  buildHomeClientChatTransportHeaders,
  createOpenListMessage,
  createRegeneratedAssistantSnapshot,
  findRegenerateAssistantTarget,
  normalizeUploadedAttachmentParts,
  shouldShowHomeClientThinking,
} from "../src/app/home-client-chat-session";

function makeMessage(input: {
  id: string;
  role: UIMessage<RemcoChatMessageMetadata>["role"];
  text?: string;
}): UIMessage<RemcoChatMessageMetadata> {
  return {
    id: input.id,
    role: input.role,
    parts: input.text == null ? [] : [{ type: "text", text: input.text }],
    metadata: { createdAt: "2026-03-26T12:00:00.000Z" },
  };
}

function makeListOverview(
  overrides: Partial<TaskListOverview> = {}
): TaskListOverview {
  return {
    id: overrides.id ?? "list-1",
    kind: overrides.kind ?? "todo",
    name: overrides.name ?? "Weekly plan",
    scope: overrides.scope ?? "owned",
    ownerProfileId: overrides.ownerProfileId ?? "profile-1",
    ownerProfileName: overrides.ownerProfileName ?? "Owner",
    updatedAt: overrides.updatedAt ?? "2026-03-26T12:00:00.000Z",
  };
}

test("buildHomeClientChatRequestBody preserves temporary and persisted routing", () => {
  assert.deepEqual(
    buildHomeClientChatRequestBody({
      activeChatId: "",
      activeProfileId: "profile-1",
      effectiveModelId: "gpt-5",
      isTemporaryChat: true,
      reasoningEffort: "medium",
      reasoningEnabled: true,
      temporarySessionId: "temp-1",
    }),
    {
      modelId: "gpt-5",
      profileId: "profile-1",
      reasoning: { effort: "medium" },
      temporary: true,
      temporarySessionId: "temp-1",
    }
  );

  assert.deepEqual(
    buildHomeClientChatRequestBody({
      activeChatId: "chat-1",
      activeProfileId: "profile-1",
      effectiveModelId: "gpt-5",
      isTemporaryChat: false,
      reasoningEffort: "medium",
      reasoningEnabled: false,
      temporarySessionId: "temp-1",
    }),
    {
      chatId: "chat-1",
      modelId: "gpt-5",
      profileId: "profile-1",
    }
  );
});

test("buildHomeClientChatTransportHeaders preserves timezone and admin-token policy", () => {
  assert.deepEqual(
    buildHomeClientChatTransportHeaders({
      lanAdminAccessEnabled: false,
      readLanAdminToken: () => "secret-token",
      viewerTimezone: "Europe/Amsterdam",
    }),
    {
      "x-remcochat-viewer-timezone": "Europe/Amsterdam",
    }
  );

  assert.deepEqual(
    buildHomeClientChatTransportHeaders({
      lanAdminAccessEnabled: true,
      readLanAdminToken: () => "secret-token",
      viewerTimezone: "Europe/Amsterdam",
    }),
    {
      "x-remcochat-admin-token": "secret-token",
      "x-remcochat-viewer-timezone": "Europe/Amsterdam",
    }
  );
});

test("shouldShowHomeClientThinking matches the existing streaming policy", () => {
  assert.equal(
    shouldShowHomeClientThinking({
      error: null,
      messages: [makeMessage({ id: "user-1", role: "user", text: "Hi" })],
      status: "submitted",
    }),
    true
  );

  assert.equal(
    shouldShowHomeClientThinking({
      error: null,
      messages: [
        makeMessage({ id: "user-1", role: "user", text: "Hi" }),
        makeMessage({ id: "assistant-1", role: "assistant", text: "Hello" }),
      ],
      status: "streaming",
    }),
    false
  );

  assert.equal(
    shouldShowHomeClientThinking({
      error: new Error("boom"),
      messages: [makeMessage({ id: "user-1", role: "user", text: "Hi" })],
      status: "streaming",
    }),
    false
  );
});

test("findRegenerateAssistantTarget finds the latest assistant turn and user owner", () => {
  const target = findRegenerateAssistantTarget([
    makeMessage({ id: "user-1", role: "user", text: "First" }),
    makeMessage({ id: "assistant-1", role: "assistant", text: "Reply 1" }),
    makeMessage({ id: "user-2", role: "user", text: "Second" }),
    makeMessage({ id: "assistant-2", role: "assistant", text: "Reply 2" }),
  ]);

  assert.equal(target.assistant?.id, "assistant-2");
  assert.equal(target.lastUserId, "user-2");
});

test("createRegeneratedAssistantSnapshot preserves content while updating variant metadata", () => {
  const snapshot = createRegeneratedAssistantSnapshot({
    assistant: makeMessage({
      id: "assistant-1",
      role: "assistant",
      text: "Reply",
    }),
    createdAt: "2026-03-26T12:30:00.000Z",
    id: "assistant-variant-1",
    turnUserMessageId: "user-1",
  });

  assert.equal(snapshot.id, "assistant-variant-1");
  assert.equal(snapshot.parts[0]?.type, "text");
  assert.deepEqual(snapshot.metadata, {
    createdAt: "2026-03-26T12:30:00.000Z",
    turnUserMessageId: "user-1",
  });
});

test("createOpenListMessage keeps the shared-owner suffix behavior", () => {
  const message = createOpenListMessage(
    makeListOverview({
      name: "Groceries",
      ownerProfileName: "Alice",
      scope: "shared",
    })
  );

  assert.match(message.text, /^Open list "Groceries" from Alice\.$/);
});

test("normalizeUploadedAttachmentParts filters incomplete attachment responses", () => {
  assert.deepEqual(
    normalizeUploadedAttachmentParts({
      attachments: [
        {
          attachmentUrl: "https://example.com/a.pdf",
          filename: "a.pdf",
          mediaType: "application/pdf",
        },
        {
          attachmentUrl: "",
          filename: "missing.pdf",
          mediaType: "application/pdf",
        },
        {
          attachmentUrl: "https://example.com/no-type.pdf",
          filename: "no-type.pdf",
          mediaType: "",
        },
      ],
    }),
    [
      {
        filename: "a.pdf",
        mediaType: "application/pdf",
        type: "file",
        url: "https://example.com/a.pdf",
      },
    ]
  );
});
