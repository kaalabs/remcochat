import test from "node:test";
import assert from "node:assert/strict";

import type { AccessibleChat } from "../src/domain/chats/types";
import {
  chatIsPinned,
  sortChatsForSidebar,
} from "../src/app/home-client-chat-actions";

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
    createdAt: overrides.createdAt ?? "2026-03-26T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-26T09:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    forkedFromChatId: overrides.forkedFromChatId,
    forkedFromMessageId: overrides.forkedFromMessageId,
    scope: overrides.scope ?? "owned",
    ownerName: overrides.ownerName ?? "Owner",
  };
}

test("chatIsPinned only accepts non-empty pinned timestamps", () => {
  assert.equal(chatIsPinned(makeChat({ pinnedAt: null })), false);
  assert.equal(chatIsPinned(makeChat({ pinnedAt: "   " })), false);
  assert.equal(chatIsPinned(makeChat({ pinnedAt: "2026-03-26T09:05:00.000Z" })), true);
});

test("sortChatsForSidebar orders pinned chats first, then recency", () => {
  const chats = [
    makeChat({
      id: "unpinned-newer",
      updatedAt: "2026-03-26T09:04:00.000Z",
    }),
    makeChat({
      id: "pinned-older",
      pinnedAt: "2026-03-26T09:01:00.000Z",
      updatedAt: "2026-03-26T09:01:00.000Z",
    }),
    makeChat({
      id: "unpinned-older",
      updatedAt: "2026-03-26T09:02:00.000Z",
    }),
    makeChat({
      id: "pinned-newer",
      pinnedAt: "2026-03-26T09:03:00.000Z",
      updatedAt: "2026-03-26T09:03:00.000Z",
    }),
  ];

  assert.deepEqual(
    sortChatsForSidebar(chats).map((chat) => chat.id),
    ["pinned-newer", "pinned-older", "unpinned-newer", "unpinned-older"]
  );
  assert.deepEqual(
    chats.map((chat) => chat.id),
    ["unpinned-newer", "pinned-older", "unpinned-older", "pinned-newer"]
  );
});
