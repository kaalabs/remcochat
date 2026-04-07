import assert from "node:assert/strict";
import test from "node:test";

import type { Profile } from "../src/domain/profiles/types";
import {
  buildProfileSettingsRequestBody,
  updateSavedProfile,
} from "../src/app/home-client-profile-save";

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

test("buildProfileSettingsRequestBody preserves the explicit settings payload", () => {
  assert.deepEqual(
    buildProfileSettingsRequestBody({
      customInstructions: "Be concise",
      memoryEnabled: false,
      uiLanguage: "nl",
    }),
    {
      customInstructions: "Be concise",
      memoryEnabled: false,
      uiLanguage: "nl",
    }
  );
});

test("updateSavedProfile replaces only the matching profile entry", () => {
  const original = [
    makeProfile({ id: "profile-1", name: "Alice" }),
    makeProfile({ id: "profile-2", name: "Bob" }),
  ];
  const nextProfile = makeProfile({
    id: "profile-2",
    name: "Bobby",
    customInstructions: "Updated",
  });

  assert.deepEqual(updateSavedProfile(original, nextProfile), [
    original[0],
    nextProfile,
  ]);
});
