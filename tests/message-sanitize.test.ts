import assert from "node:assert/strict";
import { test } from "node:test";
import { stripWebToolPartsFromMessages } from "../src/server/message-sanitize";

test("strips web tool parts from messages", () => {
  const input = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "zoek iets" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolCallId: "t1",
          toolName: "web_search",
          input: { query: "x" },
        },
        {
          type: "tool-result",
          toolCallId: "t1",
          toolName: "web_search",
          output: { results: [] },
        },
        {
          type: "tool-web_search",
          toolCallId: "t2",
          state: "input-available",
          input: { query: "y" },
          providerExecuted: true,
        },
        {
          type: "tool-perplexity_search",
          toolCallId: "t3",
          state: "output-available",
          input: { query: "z" },
          output: { id: "id", results: [] },
          providerExecuted: true,
        },
        { type: "text", text: "https://example.com" },
      ],
    },
  ] as unknown as Parameters<typeof stripWebToolPartsFromMessages>[0];

  const out = stripWebToolPartsFromMessages(input);
  assert.equal(out.length, 2);
  assert.equal(out[1].parts.length, 1);
  assert.deepEqual(out[1].parts[0], { type: "text", text: "https://example.com" });
});
