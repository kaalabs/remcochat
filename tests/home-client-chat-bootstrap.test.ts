import assert from "node:assert/strict";
import test from "node:test";

import type { AccessibleChat } from "../src/domain/chats/types";
import {
  insertCreatedChatIntoSidebar,
  resolveRefreshedActiveChatId,
} from "../src/app/home-client-chat-bootstrap";

function makeChat(overrides: Partial<AccessibleChat> = {}): AccessibleChat {
  return {
    id: overrides.id ?? "chat-1",
    profileId: overrides.profileId ?? "profile-1",
    title: overrides.title ?? "Chat",
    modelId: overrides.modelId ?? "test-model",
    folderId: overrides.folderId ?? null,
    pinnedAt: overrides.pinnedAt ?? null,
    chatInstructions: overrides.chatInstructions ?? "",
    chatInstructionsRevision: overrides.chatInstructionsRevision ?? 0,
    activatedSkillNames: overrides.activatedSkillNames ?? [],
    createdAt: overrides.createdAt ?? "2026-03-26T11:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-26T11:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    forkedFromChatId: overrides.forkedFromChatId,
    forkedFromMessageId: overrides.forkedFromMessageId,
    scope: overrides.scope ?? "owned",
    ownerName: overrides.ownerName ?? "Owner",
  };
}

test("resolveRefreshedActiveChatId preserves the current preference order", () => {
  const chats = [
    makeChat({ id: "archived", archivedAt: "2026-03-26T11:01:00.000Z" }),
    makeChat({ id: "stored", updatedAt: "2026-03-26T11:02:00.000Z" }),
    makeChat({ id: "fresh", updatedAt: "2026-03-26T11:03:00.000Z" }),
  ];

  assert.equal(
    resolveRefreshedActiveChatId({
      chats,
      preferredChatId: "fresh",
      storedChatId: "stored",
    }),
    "fresh"
  );

  assert.equal(
    resolveRefreshedActiveChatId({
      chats,
      preferredChatId: "missing",
      storedChatId: "stored",
    }),
    ""
  );

  assert.equal(
    resolveRefreshedActiveChatId({
      chats,
      storedChatId: "stored",
    }),
    "stored"
  );

  assert.equal(
    resolveRefreshedActiveChatId({
      chats: [chats[0]],
      storedChatId: "archived",
    }),
    "archived"
  );
});

test("insertCreatedChatIntoSidebar deduplicates and sorts the new chat", () => {
  const existing = [
    makeChat({
      id: "older-pinned",
      pinnedAt: "2026-03-26T10:00:00.000Z",
      updatedAt: "2026-03-26T10:00:00.000Z",
    }),
    makeChat({
      id: "recent",
      updatedAt: "2026-03-26T11:10:00.000Z",
    }),
    makeChat({
      id: "created",
      updatedAt: "2026-03-26T09:00:00.000Z",
    }),
  ];

  const created = makeChat({
    id: "created",
    pinnedAt: "2026-03-26T11:20:00.000Z",
    updatedAt: "2026-03-26T11:20:00.000Z",
  });

  assert.deepEqual(
    insertCreatedChatIntoSidebar(existing, created).map((chat) => chat.id),
    ["created", "older-pinned", "recent"]
  );
});
