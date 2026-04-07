import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createChatResponseHeaders,
  createChatRuntimeHeaderExtras,
  createTurnMessageMetadata,
  getLastUserTurnContext,
  needsViewerTimeZoneForAgenda,
  resolveViewerTimeZone,
} from "../src/server/chat/request-context";
import type { ChatMessage } from "../src/server/chat/types";

function message(input: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage {
  return {
    id: input.id,
    role: input.role,
    metadata: input.metadata,
    parts: input.parts ?? [],
  };
}

test("resolveViewerTimeZone returns a valid header timezone", () => {
  const request = new Request("http://localhost", {
    headers: { "x-remcochat-viewer-timezone": "Europe/Amsterdam" },
  });

  assert.equal(resolveViewerTimeZone(request), "Europe/Amsterdam");
});

test("resolveViewerTimeZone rejects invalid header values", () => {
  const request = new Request("http://localhost", {
    headers: { "x-remcochat-viewer-timezone": "Mars/Olympus" },
  });

  assert.equal(resolveViewerTimeZone(request), undefined);
});

test("getLastUserTurnContext returns the latest and previous user texts", () => {
  const context = getLastUserTurnContext([
    message({
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "first question" }],
    }),
    message({
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "answer" }],
    }),
    message({
      id: "u2",
      role: "user",
      parts: [{ type: "text", text: "second question" }],
    }),
  ]);

  assert.equal(context.lastUserMessageId, "u2");
  assert.equal(context.lastUserText, "second question");
  assert.equal(context.previousUserText, "first question");
});

test("needsViewerTimeZoneForAgenda only requires timezone when agenda command needs one", () => {
  assert.equal(
    needsViewerTimeZoneForAgenda(
      {
        action: "create",
        description: "Lunch",
        date: "2026-03-25",
        time: "12:00",
        durationMinutes: 60,
      },
      undefined
    ),
    true
  );

  assert.equal(
    needsViewerTimeZoneForAgenda(
      {
        action: "list",
        range: { kind: "today", timezone: "Europe/Amsterdam" },
        includeOverlaps: true,
      },
      undefined
    ),
    false
  );
});

test("createTurnMessageMetadata only includes provided revision fields", () => {
  assert.deepEqual(
    createTurnMessageMetadata({
      createdAt: "2026-03-25T00:00:00Z",
      turnUserMessageId: "u1",
    }),
    {
      createdAt: "2026-03-25T00:00:00Z",
      turnUserMessageId: "u1",
    }
  );
});

test("createChatResponseHeaders adds common and optional chat headers", () => {
  const headers = createChatResponseHeaders({
    apiVersion: "instruction-frame-v1",
    temporary: false,
    profileId: "profile-1",
    chatId: "chat-1",
    extra: {
      "x-remcochat-provider-id": "openai",
      "x-remcochat-empty": undefined,
    },
  });

  assert.deepEqual(headers, {
    "x-remcochat-api-version": "instruction-frame-v1",
    "x-remcochat-temporary": "0",
    "x-remcochat-profile-id": "profile-1",
    "x-remcochat-chat-id": "chat-1",
    "x-remcochat-provider-id": "openai",
  });
});

test("createChatRuntimeHeaderExtras includes runtime, tool, and stored prompt metadata", () => {
  const disabledBundle = {
    enabled: false,
    tools: {},
    metadataByName: {},
    entries: [],
  };
  const headers = createChatRuntimeHeaderExtras({
    resolved: {
      providerId: "openai",
      modelType: "openai_responses",
      providerModelId: "gpt-5",
      modelId: "gpt-5",
      capabilities: { reasoning: true },
    },
    reasoning: {
      enabled: true,
      exposeToClient: true,
      requestedEffort: "high",
      effectiveEffort: "medium",
    },
    profileInstructions: "Be concise",
    profileInstructionsRevision: 3,
    chatInstructions: "Focus on transport",
    chatInstructionsRevision: 7,
    storedProfileInstructions: "Stored prompt",
    webTools: {
      ...disabledBundle,
      enabled: true,
      tools: { exa_search: {} },
    },
    localAccessTools: disabledBundle,
    bashTools: {
      ...disabledBundle,
      enabled: true,
      tools: { bash: {} },
    },
    ovNlTools: {
      ...disabledBundle,
      enabled: true,
      tools: { ovNlGateway: {} },
    },
  });

  assert.equal(headers["x-remcochat-provider-id"], "openai");
  assert.equal(headers["x-remcochat-reasoning-enabled"], "1");
  assert.equal(headers["x-remcochat-reasoning-effort"], "medium");
  assert.equal(headers["x-remcochat-profile-instructions-rev"], "3");
  assert.equal(headers["x-remcochat-chat-instructions-rev"], "7");
  assert.equal(headers["x-remcochat-web-tools-enabled"], "1");
  assert.equal(headers["x-remcochat-web-tools"], "exa_search");
  assert.equal(headers["x-remcochat-bash-tools-enabled"], "1");
  assert.equal(headers["x-remcochat-bash-tools"], "bash");
  assert.equal(headers["x-remcochat-ov-nl-tools-enabled"], "1");
  assert.equal(headers["x-remcochat-ov-nl-tools"], "ovNlGateway");
  assert.equal(headers["x-remcochat-profile-instructions-stored-len"], "13");
});
