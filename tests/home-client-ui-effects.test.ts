import assert from "node:assert/strict";
import test from "node:test";

import {
  isComposerFocusBlocked,
  resolveGlobalShortcutAction,
  shouldPinTranscriptDuringStreaming,
} from "../src/app/home-client-ui-effects";

test("isComposerFocusBlocked returns true when any modal surface is open", () => {
  assert.equal(
    isComposerFocusBlocked({
      chatSettingsOpen: false,
      createProfileOpen: false,
      editOpen: false,
      memorizeOpen: false,
      profileSettingsOpen: false,
      profileSelectOpen: false,
    }),
    false
  );

  assert.equal(
    isComposerFocusBlocked({
      chatSettingsOpen: false,
      createProfileOpen: true,
      editOpen: false,
      memorizeOpen: false,
      profileSettingsOpen: false,
      profileSelectOpen: false,
    }),
    true
  );
});

test("shouldPinTranscriptDuringStreaming only pins for submitted and streaming states", () => {
  assert.equal(shouldPinTranscriptDuringStreaming("submitted"), true);
  assert.equal(shouldPinTranscriptDuringStreaming("streaming"), true);
  assert.equal(shouldPinTranscriptDuringStreaming("ready"), false);
});

test("resolveGlobalShortcutAction preserves the existing shortcut policy", () => {
  assert.equal(
    resolveGlobalShortcutAction({
      chatSettingsOpen: false,
      createProfileOpen: false,
      ctrlKey: false,
      defaultPrevented: false,
      editOpen: false,
      key: "Escape",
      memorizeOpen: false,
      metaKey: false,
      profileSettingsOpen: false,
      profileSelectOpen: false,
      shiftKey: false,
      status: "streaming",
    }),
    "stop-stream"
  );

  assert.equal(
    resolveGlobalShortcutAction({
      chatSettingsOpen: false,
      createProfileOpen: false,
      ctrlKey: true,
      defaultPrevented: false,
      editOpen: false,
      key: "N",
      memorizeOpen: false,
      metaKey: false,
      profileSettingsOpen: false,
      profileSelectOpen: false,
      shiftKey: true,
      status: "ready",
    }),
    "create-chat"
  );

  assert.equal(
    resolveGlobalShortcutAction({
      chatSettingsOpen: false,
      createProfileOpen: false,
      ctrlKey: true,
      defaultPrevented: false,
      editOpen: false,
      key: "/",
      memorizeOpen: false,
      metaKey: false,
      profileSettingsOpen: false,
      profileSelectOpen: false,
      shiftKey: false,
      status: "ready",
    }),
    "focus-composer"
  );

  assert.equal(
    resolveGlobalShortcutAction({
      chatSettingsOpen: false,
      createProfileOpen: false,
      ctrlKey: false,
      defaultPrevented: false,
      editOpen: true,
      key: "Escape",
      memorizeOpen: false,
      metaKey: false,
      profileSettingsOpen: false,
      profileSelectOpen: false,
      shiftKey: false,
      status: "streaming",
    }),
    "none"
  );
});
