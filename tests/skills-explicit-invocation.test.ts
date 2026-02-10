import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage } from "ai";
import {
  isExplicitSkillActivationOnlyPrompt,
  stripExplicitSkillInvocationFromMessages,
} from "../src/server/skills/explicit-invocation";

function makeUserMessage(text: string) {
  return {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text }],
  } as UIMessage;
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

test("strips /skill-name prefix with whitespace", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage("/skills-system-validation do the thing")],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, "skills-system-validation");
  assert.equal(messageText(res.messages[0] as UIMessage), "do the thing");
});

test("strips /skill-name prefix at end-of-line", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage("/skills-system-validation")],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, "skills-system-validation");
  assert.equal(messageText(res.messages[0] as UIMessage), "");
});

test("strips /skill-name prefix before newline", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage("/skills-system-validation\nnext line")],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, "skills-system-validation");
  assert.equal(messageText(res.messages[0] as UIMessage), "next line");
});

test("ignores unknown skill names", () => {
  const original = "/unknown-skill do stuff";
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage(original)],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, null);
  assert.equal(messageText(res.messages[0] as UIMessage), original);
});

test("only strips from the latest user message", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [
      makeUserMessage("/skills-system-validation first"),
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] } as UIMessage,
      makeUserMessage("/skills-system-validation second"),
    ],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, "skills-system-validation");
  assert.equal(
    messageText(res.messages[0] as UIMessage),
    "/skills-system-validation first"
  );
  assert.equal(messageText(res.messages[2] as UIMessage), "second");
});

test("activation-only prompt is true for bare /skill invocation", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage("/skills-system-validation")],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(
    isExplicitSkillActivationOnlyPrompt({
      messages: res.messages as UIMessage[],
      explicitSkillName: res.explicitSkillName,
    }),
    true
  );
});

test("activation-only prompt is false when user included extra text", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage("/skills-system-validation run checks")],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(
    isExplicitSkillActivationOnlyPrompt({
      messages: res.messages as UIMessage[],
      explicitSkillName: res.explicitSkillName,
    }),
    false
  );
});
