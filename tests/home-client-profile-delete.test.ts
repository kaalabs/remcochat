import assert from "node:assert/strict";
import test from "node:test";

import type { Profile } from "../src/domain/profiles/types";
import {
  canConfirmDeleteProfile,
  isDeleteProfileConfirmationValid,
} from "../src/app/home-client-profile-delete";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: overrides.id ?? "profile-1",
    name: overrides.name ?? "Alice",
    defaultModelId: overrides.defaultModelId ?? "test-model",
    customInstructions: overrides.customInstructions ?? "",
    customInstructionsRevision: overrides.customInstructionsRevision ?? 0,
    memoryEnabled: overrides.memoryEnabled ?? true,
    uiLanguage: overrides.uiLanguage ?? "en",
    avatar: overrides.avatar ?? null,
    createdAt: overrides.createdAt ?? "2026-03-26T11:20:00.000Z",
  };
}

test("isDeleteProfileConfirmationValid accepts DELETE or the exact profile name", () => {
  assert.equal(isDeleteProfileConfirmationValid(" DELETE ", "Alice"), true);
  assert.equal(isDeleteProfileConfirmationValid("Alice", "Alice"), true);
  assert.equal(isDeleteProfileConfirmationValid("alice", "Alice"), false);
  assert.equal(isDeleteProfileConfirmationValid("", "Alice"), false);
});

test("canConfirmDeleteProfile enforces readiness, confirmation, and saving guards", () => {
  const activeProfile = makeProfile({ name: "Alice" });

  assert.equal(
    canConfirmDeleteProfile({
      activeProfile,
      confirm: "Alice",
      saving: false,
      statusReady: true,
    }),
    true
  );

  assert.equal(
    canConfirmDeleteProfile({
      activeProfile,
      confirm: "Alice",
      saving: true,
      statusReady: true,
    }),
    false
  );

  assert.equal(
    canConfirmDeleteProfile({
      activeProfile,
      confirm: "Alice",
      saving: false,
      statusReady: false,
    }),
    false
  );

  assert.equal(
    canConfirmDeleteProfile({
      activeProfile: null,
      confirm: "DELETE",
      saving: false,
      statusReady: true,
    }),
    false
  );
});
