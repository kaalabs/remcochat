import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareTemporaryPromptContext } from "../src/server/chat/temporary-chat-context";

test("prepareTemporaryPromptContext trims the session id and builds the temporary prompt payload", () => {
  const context = prepareTemporaryPromptContext({
    profileCustomInstructions: " Be concise ",
    profileInstructionsRevision: 3,
    temporarySessionId: " tmp-123 ",
  });

  assert.equal(context.temporarySessionId, "tmp-123");
  assert.equal(context.sessionKey, "tmp:tmp-123");
  assert.deepEqual(context.prompt, {
    isTemporary: true,
    profileInstructions: "Be concise",
    profileInstructionsRevision: 3,
    chatInstructions: "",
    systemChatInstructionsRevision: 1,
    headerChatInstructionsRevision: 0,
    memoryEnabled: false,
    memoryLines: [],
    activatedSkillNames: [],
  });
});

test("prepareTemporaryPromptContext falls back cleanly when the temporary session id is empty", () => {
  const context = prepareTemporaryPromptContext({
    profileCustomInstructions: null,
    profileInstructionsRevision: 1,
    temporarySessionId: "   ",
  });

  assert.equal(context.temporarySessionId, "");
  assert.equal(context.sessionKey, "");
  assert.equal(context.prompt.profileInstructions, "");
});
