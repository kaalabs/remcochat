import assert from "node:assert/strict";
import test from "node:test";

import type { AccessibleChat } from "../src/domain/chats/types";
import type { Profile } from "../src/domain/profiles/types";
import {
  hasHomeClientArchivedChats,
  resolveInitialHomeClientActiveChatId,
  resolveInitialHomeClientProfileDefaultModelId,
  resolveInitialHomeClientProfileId,
} from "../src/app/home-client-app-state";

function makeProfile(
  overrides: Partial<Profile> & Pick<Profile, "id" | "name" | "defaultModelId">
): Profile {
  return {
    id: overrides.id,
    name: overrides.name,
    createdAt: overrides.createdAt ?? "2026-03-26T12:00:00.000Z",
    defaultModelId: overrides.defaultModelId,
    customInstructions: overrides.customInstructions ?? "",
    customInstructionsRevision: overrides.customInstructionsRevision ?? 0,
    memoryEnabled: overrides.memoryEnabled ?? true,
    uiLanguage: overrides.uiLanguage ?? "en",
    avatar: overrides.avatar ?? null,
  };
}

function makeChat(
  overrides: Partial<AccessibleChat> & Pick<AccessibleChat, "id" | "profileId">
): AccessibleChat {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    profileId: overrides.profileId,
    modelId: overrides.modelId ?? "model-1",
    createdAt: overrides.createdAt ?? "2026-03-26T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-26T12:00:00.000Z",
    folderId: overrides.folderId ?? null,
    chatInstructions: overrides.chatInstructions ?? "",
    chatInstructionsRevision: overrides.chatInstructionsRevision ?? 0,
    activatedSkillNames: overrides.activatedSkillNames ?? [],
    scope: overrides.scope ?? "owned",
    pinnedAt: overrides.pinnedAt ?? null,
    archivedAt: overrides.archivedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    ownerName: overrides.ownerName ?? "Owner",
  };
}

test("resolveInitialHomeClientProfileId keeps a valid initial profile and falls back to the first", () => {
  const profiles = [
    makeProfile({ id: "profile-1", name: "One", defaultModelId: "model-a" }),
    makeProfile({ id: "profile-2", name: "Two", defaultModelId: "model-b" }),
  ];

  assert.equal(
    resolveInitialHomeClientProfileId({
      initialActiveProfileId: "profile-2",
      initialProfiles: profiles,
    }),
    "profile-2"
  );

  assert.equal(
    resolveInitialHomeClientProfileId({
      initialActiveProfileId: "missing",
      initialProfiles: profiles,
    }),
    "profile-1"
  );
});

test("resolveInitialHomeClientProfileDefaultModelId follows the resolved initial profile", () => {
  const profiles = [
    makeProfile({ id: "profile-1", name: "One", defaultModelId: "model-a" }),
    makeProfile({ id: "profile-2", name: "Two", defaultModelId: "model-b" }),
  ];

  assert.equal(
    resolveInitialHomeClientProfileDefaultModelId({
      initialActiveProfileId: "profile-2",
      initialProfiles: profiles,
    }),
    "model-b"
  );

  assert.equal(
    resolveInitialHomeClientProfileDefaultModelId({
      initialActiveProfileId: "missing",
      initialProfiles: profiles,
    }),
    "model-a"
  );
});

test("resolveInitialHomeClientActiveChatId keeps the first chat id and falls back to empty", () => {
  assert.equal(
    resolveInitialHomeClientActiveChatId([
      makeChat({ id: "chat-1", profileId: "profile-1" }),
      makeChat({ id: "chat-2", profileId: "profile-1" }),
    ]),
    "chat-1"
  );

  assert.equal(resolveInitialHomeClientActiveChatId([]), "");
});

test("hasHomeClientArchivedChats detects archived chats only", () => {
  assert.equal(
    hasHomeClientArchivedChats([
      makeChat({ id: "chat-1", profileId: "profile-1" }),
      makeChat({
        id: "chat-2",
        profileId: "profile-1",
        archivedAt: "2026-03-26T12:30:00.000Z",
      }),
    ]),
    true
  );

  assert.equal(
    hasHomeClientArchivedChats([
      makeChat({ id: "chat-1", profileId: "profile-1" }),
      makeChat({ id: "chat-2", profileId: "profile-1" }),
    ]),
    false
  );
});
