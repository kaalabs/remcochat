import test from "node:test";
import assert from "node:assert/strict";

import type { AccessibleChat } from "../src/domain/chats/types";
import {
  canOpenChatSettings,
  resolveChatInstructionsDraft,
  resolveChatSettingsTargetId,
} from "../src/app/home-client-chat-settings";

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
    createdAt: overrides.createdAt ?? "2026-03-26T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-26T10:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    forkedFromChatId: overrides.forkedFromChatId,
    forkedFromMessageId: overrides.forkedFromMessageId,
    scope: overrides.scope ?? "owned",
    ownerName: overrides.ownerName ?? "Owner",
  };
}

test("canOpenChatSettings only allows ready managed persisted chats", () => {
  assert.equal(
    canOpenChatSettings({
      activeChatId: "chat-1",
      canManageActiveChat: true,
      isTemporaryChat: false,
      statusReady: true,
    }),
    true
  );
  assert.equal(
    canOpenChatSettings({
      activeChatId: "",
      canManageActiveChat: true,
      isTemporaryChat: false,
      statusReady: true,
    }),
    false
  );
  assert.equal(
    canOpenChatSettings({
      activeChatId: "chat-1",
      canManageActiveChat: false,
      isTemporaryChat: false,
      statusReady: true,
    }),
    false
  );
  assert.equal(
    canOpenChatSettings({
      activeChatId: "chat-1",
      canManageActiveChat: true,
      isTemporaryChat: true,
      statusReady: true,
    }),
    false
  );
  assert.equal(
    canOpenChatSettings({
      activeChatId: "chat-1",
      canManageActiveChat: true,
      isTemporaryChat: false,
      statusReady: false,
    }),
    false
  );
});

test("resolveChatSettingsTargetId prefers the explicitly opened chat", () => {
  assert.equal(
    resolveChatSettingsTargetId({
      activeChatId: "chat-active",
      chatSettingsChatId: "chat-settings",
    }),
    "chat-settings"
  );
  assert.equal(
    resolveChatSettingsTargetId({
      activeChatId: "chat-active",
      chatSettingsChatId: "",
    }),
    "chat-active"
  );
});

test("resolveChatInstructionsDraft prefers the tracked settings chat", () => {
  const activeChat = makeChat({
    id: "chat-active",
    chatInstructions: "active instructions",
  });
  const otherChat = makeChat({
    id: "chat-other",
    chatInstructions: "other instructions",
  });

  assert.equal(
    resolveChatInstructionsDraft({
      activeChat,
      chatSettingsChatId: "chat-other",
      chats: [activeChat, otherChat],
    }),
    "other instructions"
  );
  assert.equal(
    resolveChatInstructionsDraft({
      activeChat,
      chatSettingsChatId: "missing",
      chats: [otherChat],
    }),
    "active instructions"
  );
  assert.equal(
    resolveChatInstructionsDraft({
      activeChat: null,
      chatSettingsChatId: "missing",
      chats: [],
    }),
    ""
  );
});
