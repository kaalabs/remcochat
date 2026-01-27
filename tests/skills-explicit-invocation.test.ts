import assert from "node:assert/strict";
import { test } from "node:test";
import { stripExplicitSkillInvocationFromMessages } from "../src/server/skills/explicit-invocation";

function makeUserMessage(text: string) {
  return {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text }],
  } as const;
}

test("strips /skill-name prefix with whitespace", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage("/skills-system-validation do the thing")],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, "skills-system-validation");
  assert.equal((res.messages[0] as any).parts[0].text, "do the thing");
});

test("strips /skill-name prefix at end-of-line", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage("/skills-system-validation")],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, "skills-system-validation");
  assert.equal((res.messages[0] as any).parts[0].text, "");
});

test("strips /skill-name prefix before newline", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage("/skills-system-validation\nnext line")],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, "skills-system-validation");
  assert.equal((res.messages[0] as any).parts[0].text, "next line");
});

test("ignores unknown skill names", () => {
  const original = "/unknown-skill do stuff";
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [makeUserMessage(original)],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, null);
  assert.equal((res.messages[0] as any).parts[0].text, original);
});

test("only strips from the latest user message", () => {
  const res = stripExplicitSkillInvocationFromMessages({
    messages: [
      makeUserMessage("/skills-system-validation first"),
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "ok" }] } as any,
      makeUserMessage("/skills-system-validation second"),
    ],
    skillNames: new Set(["skills-system-validation"]),
  });

  assert.equal(res.explicitSkillName, "skills-system-validation");
  assert.equal((res.messages[0] as any).parts[0].text, "/skills-system-validation first");
  assert.equal((res.messages[2] as any).parts[0].text, "second");
});

