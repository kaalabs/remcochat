import assert from "node:assert/strict";
import test from "node:test";

import type { AccessibleChat } from "../src/domain/chats/types";
import type { Profile } from "../src/domain/profiles/types";
import {
  resolveActiveProfile,
  resolveFallbackActiveChatId,
  resolveInitialActiveProfileId,
  resolveRestoredActiveProfileId,
} from "../src/app/home-client-profile-selection";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: overrides.id ?? "profile-1",
    name: overrides.name ?? "Profile 1",
    defaultModelId: overrides.defaultModelId ?? "model-1",
    customInstructions: overrides.customInstructions ?? "",
    customInstructionsRevision: overrides.customInstructionsRevision ?? 0,
    uiLanguage: overrides.uiLanguage ?? "en",
    memoryEnabled: overrides.memoryEnabled ?? false,
    avatar: overrides.avatar ?? null,
    createdAt: overrides.createdAt ?? "2026-03-26T11:00:00.000Z",
  };
}

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

test("resolveInitialActiveProfileId keeps a valid initial profile and falls back to the first", () => {
  const profiles = [
    makeProfile({ id: "profile-a" }),
    makeProfile({ id: "profile-b" }),
  ];

  assert.equal(
    resolveInitialActiveProfileId({
      initialActiveProfileId: "profile-b",
      profiles,
    }),
    "profile-b"
  );

  assert.equal(
    resolveInitialActiveProfileId({
      initialActiveProfileId: "missing",
      profiles,
    }),
    "profile-a"
  );
});

test("resolveRestoredActiveProfileId restores only a different valid stored profile", () => {
  const profiles = [
    makeProfile({ id: "profile-a" }),
    makeProfile({ id: "profile-b" }),
  ];

  assert.equal(
    resolveRestoredActiveProfileId({
      activeProfileId: "profile-a",
      profiles,
      storedProfileId: "profile-b",
    }),
    "profile-b"
  );

  assert.equal(
    resolveRestoredActiveProfileId({
      activeProfileId: "profile-a",
      profiles,
      storedProfileId: "profile-a",
    }),
    ""
  );

  assert.equal(
    resolveRestoredActiveProfileId({
      activeProfileId: "profile-a",
      profiles,
      storedProfileId: "missing",
    }),
    ""
  );
});

test("resolveActiveProfile falls back to the first profile when the selected id is missing", () => {
  const profiles = [
    makeProfile({ id: "profile-a" }),
    makeProfile({ id: "profile-b" }),
  ];

  assert.equal(
    resolveActiveProfile({
      activeProfileId: "profile-b",
      profiles,
    })?.id,
    "profile-b"
  );

  assert.equal(
    resolveActiveProfile({
      activeProfileId: "missing",
      profiles,
    })?.id,
    "profile-a"
  );

  assert.equal(
    resolveActiveProfile({
      activeProfileId: "missing",
      profiles: [],
    }),
    null
  );
});

test("resolveFallbackActiveChatId preserves valid selections and falls back to the first unarchived chat", () => {
  const chats = [
    makeChat({
      id: "archived",
      archivedAt: "2026-03-26T11:01:00.000Z",
    }),
    makeChat({
      id: "chat-a",
      updatedAt: "2026-03-26T11:02:00.000Z",
    }),
    makeChat({
      id: "chat-b",
      updatedAt: "2026-03-26T11:03:00.000Z",
    }),
  ];

  assert.equal(
    resolveFallbackActiveChatId({
      activeChat: chats[2],
      activeChatId: "chat-b",
      chats,
      isTemporaryChat: false,
    }),
    "chat-b"
  );

  assert.equal(
    resolveFallbackActiveChatId({
      activeChat: null,
      activeChatId: "missing",
      chats,
      isTemporaryChat: false,
    }),
    "chat-a"
  );

  assert.equal(
    resolveFallbackActiveChatId({
      activeChat: null,
      activeChatId: "",
      chats: [chats[0]],
      isTemporaryChat: false,
    }),
    ""
  );

  assert.equal(
    resolveFallbackActiveChatId({
      activeChat: null,
      activeChatId: "temporary-chat",
      chats,
      isTemporaryChat: true,
    }),
    "temporary-chat"
  );
});
