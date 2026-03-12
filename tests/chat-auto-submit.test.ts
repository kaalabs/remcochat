import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAutoSubmitClientInteraction } from "../src/lib/chat-auto-submit";

test("auto-submit continues after approval responses", () => {
  const shouldAutoSubmit = shouldAutoSubmitClientInteraction({
    messages: [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "run bash" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-bash",
            toolCallId: "tool_1",
            state: "approval-responded",
            input: { command: "echo hi" },
            approval: { id: "approval_1", approved: true },
          },
        ],
      },
    ],
  } as any);

  assert.equal(shouldAutoSubmit, true);
});

test("auto-submit does not continue after completed server tool calls", () => {
  const shouldAutoSubmit = shouldAutoSubmitClientInteraction({
    messages: [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "what's the current date and time?" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-displayCurrentDateTime",
            toolCallId: "tool_1",
            state: "output-available",
            input: { zone: "Europe/Amsterdam" },
            output: { local: { time24: "12:34" } },
          },
        ],
      },
    ],
  } as any);

  assert.equal(shouldAutoSubmit, false);
});

test("auto-submit does not continue for plain text assistant messages", () => {
  const shouldAutoSubmit = shouldAutoSubmitClientInteraction({
    messages: [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "hi" }],
      },
    ],
  } as any);

  assert.equal(shouldAutoSubmit, false);
});
