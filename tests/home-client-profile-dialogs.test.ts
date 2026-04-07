import assert from "node:assert/strict";
import test from "node:test";

import {
  isCreateProfileSubmitDisabled,
  resolveProfileAvatarPreviewSrc,
  shouldShowProfileAvatarDragHint,
} from "../src/app/home-client-profile-dialogs";

test("isCreateProfileSubmitDisabled requires a non-empty name and no active save", () => {
  assert.equal(
    isCreateProfileSubmitDisabled({
      creating: false,
      newProfileName: "Alice",
    }),
    false
  );
  assert.equal(
    isCreateProfileSubmitDisabled({
      creating: true,
      newProfileName: "Alice",
    }),
    true
  );
  assert.equal(
    isCreateProfileSubmitDisabled({
      creating: false,
      newProfileName: "   ",
    }),
    true
  );
});

test("resolveProfileAvatarPreviewSrc prefers draft, then stored avatar, unless removal is staged", () => {
  const profile = {
    avatar: {
      mediaType: "image/png",
      position: { x: 50, y: 50 },
      sizeBytes: 1234,
      updatedAt: "2026-03-26T10:00:00.000Z",
    },
    createdAt: "2026-03-26T09:00:00.000Z",
    customInstructions: "",
    customInstructionsRevision: 0,
    defaultModelId: "gpt-5.4-mini",
    id: "profile-1",
    memoryEnabled: true,
    name: "Alice",
    uiLanguage: "en" as const,
  };

  assert.equal(
    resolveProfileAvatarPreviewSrc({
      activeProfile: profile,
      avatarDraftObjectUrl: "blob:preview",
      avatarRemoveDraft: false,
    }),
    "blob:preview"
  );
  assert.equal(
    resolveProfileAvatarPreviewSrc({
      activeProfile: profile,
      avatarDraftObjectUrl: null,
      avatarRemoveDraft: false,
    }),
    "/api/profiles/profile-1/avatar?v=2026-03-26T10%3A00%3A00.000Z"
  );
  assert.equal(
    resolveProfileAvatarPreviewSrc({
      activeProfile: profile,
      avatarDraftObjectUrl: "blob:preview",
      avatarRemoveDraft: true,
    }),
    null
  );
  assert.equal(
    resolveProfileAvatarPreviewSrc({
      activeProfile: null,
      avatarDraftObjectUrl: null,
      avatarRemoveDraft: false,
    }),
    null
  );
});

test("shouldShowProfileAvatarDragHint only shows while an avatar preview is active", () => {
  const profile = {
    avatar: {
      mediaType: "image/png",
      position: { x: 50, y: 50 },
      sizeBytes: 1234,
      updatedAt: "2026-03-26T10:00:00.000Z",
    },
    createdAt: "2026-03-26T09:00:00.000Z",
    customInstructions: "",
    customInstructionsRevision: 0,
    defaultModelId: "gpt-5.4-mini",
    id: "profile-1",
    memoryEnabled: true,
    name: "Alice",
    uiLanguage: "en" as const,
  };

  assert.equal(
    shouldShowProfileAvatarDragHint({
      activeProfile: profile,
      avatarDraftObjectUrl: null,
      avatarRemoveDraft: false,
    }),
    true
  );
  assert.equal(
    shouldShowProfileAvatarDragHint({
      activeProfile: null,
      avatarDraftObjectUrl: "blob:preview",
      avatarRemoveDraft: false,
    }),
    true
  );
  assert.equal(
    shouldShowProfileAvatarDragHint({
      activeProfile: profile,
      avatarDraftObjectUrl: null,
      avatarRemoveDraft: true,
    }),
    false
  );
  assert.equal(
    shouldShowProfileAvatarDragHint({
      activeProfile: null,
      avatarDraftObjectUrl: null,
      avatarRemoveDraft: false,
    }),
    false
  );
});
