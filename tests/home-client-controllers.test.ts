import assert from "node:assert/strict";
import test from "node:test";

import type { AccessibleChat } from "../src/domain/chats/types";
import type { Profile } from "../src/domain/profiles/types";
import {
  canManageHomeClientActiveChat,
  isHomeClientReasoningEnabled,
} from "../src/app/home-client-controllers";

const reasoningModelWithSupport = {
  capabilities: {
    attachments: false,
    reasoning: true,
    structuredOutput: false,
    temperature: true,
    tools: true,
  },
} as Parameters<typeof isHomeClientReasoningEnabled>[0]["selectedModel"];

const reasoningModelWithoutSupport = {
  capabilities: {
    attachments: false,
    reasoning: false,
    structuredOutput: false,
    temperature: true,
    tools: true,
  },
} as Parameters<typeof isHomeClientReasoningEnabled>[0]["selectedModel"];

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

test("canManageHomeClientActiveChat only allows matching persisted owned chats", () => {
  const profile = makeProfile({
    id: "profile-1",
    name: "Owner",
    defaultModelId: "model-1",
  });
  const ownedChat = makeChat({ id: "chat-1", profileId: "profile-1" });
  const foreignChat = makeChat({ id: "chat-2", profileId: "profile-2" });

  assert.equal(
    canManageHomeClientActiveChat({
      activeChat: ownedChat,
      activeProfile: profile,
      isTemporaryChat: false,
    }),
    true
  );
  assert.equal(
    canManageHomeClientActiveChat({
      activeChat: ownedChat,
      activeProfile: profile,
      isTemporaryChat: true,
    }),
    false
  );
  assert.equal(
    canManageHomeClientActiveChat({
      activeChat: foreignChat,
      activeProfile: profile,
      isTemporaryChat: false,
    }),
    false
  );
  assert.equal(
    canManageHomeClientActiveChat({
      activeChat: null,
      activeProfile: profile,
      isTemporaryChat: false,
    }),
    false
  );
});

test("isHomeClientReasoningEnabled requires both model support and non-empty effort choices", () => {
  assert.equal(
    isHomeClientReasoningEnabled({
      reasoningOptions: ["low", "medium"],
      selectedModel: reasoningModelWithSupport,
    }),
    true
  );
  assert.equal(
    isHomeClientReasoningEnabled({
      reasoningOptions: [],
      selectedModel: reasoningModelWithSupport,
    }),
    false
  );
  assert.equal(
    isHomeClientReasoningEnabled({
      reasoningOptions: ["low"],
      selectedModel: reasoningModelWithoutSupport,
    }),
    false
  );
  assert.equal(
    isHomeClientReasoningEnabled({
      reasoningOptions: ["low"],
      selectedModel: null,
    }),
    false
  );
});
