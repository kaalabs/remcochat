import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartEditUserMessage,
  insertForkedChat,
  resolveEditForkDraftText,
} from "../src/app/home-client-edit-fork";

test("canStartEditUserMessage only allows ready persisted user turns", () => {
  assert.equal(
    canStartEditUserMessage({
      isTemporaryChat: false,
      role: "user",
      statusReady: true,
    }),
    true
  );
  assert.equal(
    canStartEditUserMessage({
      isTemporaryChat: true,
      role: "user",
      statusReady: true,
    }),
    false
  );
  assert.equal(
    canStartEditUserMessage({
      isTemporaryChat: false,
      role: "assistant",
      statusReady: true,
    }),
    false
  );
  assert.equal(
    canStartEditUserMessage({
      isTemporaryChat: false,
      role: "user",
      statusReady: false,
    }),
    false
  );
});

test("resolveEditForkDraftText returns the first user text part and ignores other roles", () => {
  assert.equal(
    resolveEditForkDraftText({
      id: "user-1",
      metadata: {},
      parts: [
        { type: "reasoning", text: "thinking" } as never,
        { type: "text", text: "Rewrite me" },
      ],
      role: "user",
    }),
    "Rewrite me"
  );
  assert.equal(
    resolveEditForkDraftText({
      id: "assistant-1",
      metadata: {},
      parts: [{ type: "text", text: "Nope" }],
      role: "assistant",
    }),
    ""
  );
});

test("insertForkedChat promotes the fork target and preserves sidebar ordering", () => {
  const chats = [
    {
      createdAt: "2026-03-26T08:00:00.000Z",
      folderId: null,
      id: "older",
      modelId: "gpt-5.4-mini",
      pinnedAt: null,
      profileId: "profile-1",
      title: "Older",
      updatedAt: "2026-03-26T08:00:00.000Z",
    },
    {
      createdAt: "2026-03-26T09:00:00.000Z",
      folderId: null,
      id: "pinned",
      modelId: "gpt-5.4-mini",
      pinnedAt: "2026-03-26T09:10:00.000Z",
      profileId: "profile-1",
      title: "Pinned",
      updatedAt: "2026-03-26T09:00:00.000Z",
    },
  ];

  const next = insertForkedChat(chats as never, {
    createdAt: "2026-03-26T10:00:00.000Z",
    folderId: null,
    id: "forked",
    modelId: "gpt-5.4-mini",
    pinnedAt: null,
    profileId: "profile-1",
    title: "Forked",
    updatedAt: "2026-03-26T10:00:00.000Z",
  } as never);

  assert.deepEqual(
    next.map((chat) => chat.id),
    ["pinned", "forked", "older"]
  );
});
