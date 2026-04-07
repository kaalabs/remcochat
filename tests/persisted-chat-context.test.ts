import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRegeneratePromptSection,
  collectPersistedMemoryLines,
  filterPersistedMessagesForCurrentInstructions,
  preparePersistedPromptContext,
  resolvePersistedPromptInstructions,
} from "../src/server/chat/persisted-chat-context";
import type { ChatMessage } from "../src/server/chat/types";

function message(
  input: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">,
): ChatMessage {
  return {
    id: input.id,
    role: input.role,
    metadata: input.metadata,
    parts: input.parts ?? [],
  };
}

test("collectPersistedMemoryLines trims, filters empties, and limits to 50", () => {
  const memory = Array.from({ length: 52 }, (_, index) => ({
    content: index === 1 ? "   " : ` item   ${index + 1} `,
  }));

  const lines = collectPersistedMemoryLines(memory);

  assert.equal(lines.length, 49);
  assert.equal(lines[0], "- item 1");
  assert.equal(lines[48], "- item 50");
});

test("resolvePersistedPromptInstructions prefers chat instructions over profile instructions", () => {
  assert.deepEqual(
    resolvePersistedPromptInstructions({
      profileCustomInstructions: " Be concise ",
      chatInstructions: "",
    }),
    {
      storedProfileInstructions: "Be concise",
      chatInstructions: "",
      promptProfileInstructions: "Be concise",
    },
  );

  assert.deepEqual(
    resolvePersistedPromptInstructions({
      profileCustomInstructions: " Be concise ",
      chatInstructions: " Focus on trains ",
    }),
    {
      storedProfileInstructions: "Be concise",
      chatInstructions: "Focus on trains",
      promptProfileInstructions: "",
    },
  );
});

test("preparePersistedPromptContext derives memory lines and the persisted prompt payload", () => {
  const context = preparePersistedPromptContext({
    profileCustomInstructions: " Be concise ",
    profileInstructionsRevision: 3,
    chatInstructions: " Focus on trains ",
    chatInstructionsRevision: 7,
    memoryEnabled: true,
    memory: [
      { content: " likes NS " },
      { content: "   " },
    ],
    activatedSkillNames: ["ov-nl-travel"],
  });

  assert.deepEqual(context.memoryLines, ["- likes NS"]);
  assert.deepEqual(context.prompt, {
    isTemporary: false,
    profileInstructions: "",
    profileInstructionsRevision: 3,
    chatInstructions: "Focus on trains",
    systemChatInstructionsRevision: 7,
    headerChatInstructionsRevision: 7,
    storedProfileInstructions: "Be concise",
    memoryEnabled: true,
    memoryLines: ["- likes NS"],
    activatedSkillNames: ["ov-nl-travel"],
  });
});

test("filterPersistedMessagesForCurrentInstructions removes stale assistant turns and regenerate target", () => {
  const filtered = filterPersistedMessagesForCurrentInstructions({
    messages: [
      message({ id: "u1", role: "user" }),
      message({
        id: "a-stale-profile",
        role: "assistant",
        metadata: {
          createdAt: "2026-03-25T00:00:00Z",
          profileInstructionsRevision: 1,
          chatInstructionsRevision: 2,
        },
      }),
      message({
        id: "a-regen",
        role: "assistant",
        metadata: {
          createdAt: "2026-03-25T00:00:00Z",
          profileInstructionsRevision: 3,
          chatInstructionsRevision: 2,
        },
      }),
      message({
        id: "a-keep",
        role: "assistant",
        metadata: {
          createdAt: "2026-03-25T00:00:00Z",
          profileInstructionsRevision: 3,
          chatInstructionsRevision: 2,
        },
      }),
      message({
        id: "a-missing",
        role: "assistant",
      }),
    ],
    regenerateMessageId: "a-regen",
    currentProfileRevision: 3,
    currentChatRevision: 2,
  });

  assert.deepEqual(
    filtered.map((entry) => entry.id),
    ["u1", "a-keep"],
  );
});

test("buildRegeneratePromptSection formats prior answers and falls back when empty", () => {
  const withPrior = buildRegeneratePromptSection({
    isRegenerate: true,
    priorAssistantTexts: [
      "First answer",
      "x".repeat(260),
    ],
  });
  assert.match(withPrior, /Regeneration: produce an alternative assistant response/);
  assert.match(withPrior, /1\. First answer/);
  assert.match(withPrior, /2\. x{20}/);
  assert.match(withPrior, /…/);

  const fallback = buildRegeneratePromptSection({
    isRegenerate: true,
    priorAssistantTexts: [],
  });
  assert.match(fallback, /Avoid repeating your previous assistant message verbatim/);

  assert.equal(
    buildRegeneratePromptSection({
      isRegenerate: false,
      priorAssistantTexts: ["ignored"],
    }),
    "",
  );
});
