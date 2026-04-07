import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAvatarPositionChanged,
  resolveProfileAvatarDraftAction,
} from "../src/app/home-client-profile-avatar";

test("hasAvatarPositionChanged ignores tiny drift and catches real movement", () => {
  assert.equal(
    hasAvatarPositionChanged({ x: 50, y: 50 }, { x: 50.05, y: 49.95 }),
    false
  );
  assert.equal(
    hasAvatarPositionChanged({ x: 50, y: 50 }, { x: 50.2, y: 50 }),
    true
  );
});

test("resolveProfileAvatarDraftAction keeps existing avatar decision precedence", () => {
  assert.equal(
    resolveProfileAvatarDraftAction({
      hasDraftFile: false,
      hasExistingAvatar: true,
      nextPosition: { x: 50, y: 50 },
      previousPosition: { x: 50, y: 50 },
      removeDraft: true,
    }),
    "remove"
  );
  assert.equal(
    resolveProfileAvatarDraftAction({
      hasDraftFile: true,
      hasExistingAvatar: true,
      nextPosition: { x: 50, y: 50 },
      previousPosition: { x: 50, y: 50 },
      removeDraft: false,
    }),
    "upload"
  );
  assert.equal(
    resolveProfileAvatarDraftAction({
      hasDraftFile: false,
      hasExistingAvatar: true,
      nextPosition: { x: 55, y: 50 },
      previousPosition: { x: 50, y: 50 },
      removeDraft: false,
    }),
    "reposition"
  );
  assert.equal(
    resolveProfileAvatarDraftAction({
      hasDraftFile: false,
      hasExistingAvatar: false,
      nextPosition: { x: 50, y: 50 },
      previousPosition: { x: 50, y: 50 },
      removeDraft: false,
    }),
    "keep"
  );
});
