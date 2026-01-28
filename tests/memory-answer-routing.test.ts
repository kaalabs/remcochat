import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldForceMemoryAnswerTool } from "../src/server/memory-answer-routing";

test("shouldForceMemoryAnswerTool: does not force on Hue/light control requests", () => {
  const memoryLines = [
    "- Woonkamer lights are Philips Hue.",
    "- WiFi password is correcthorsebatterystaple.",
  ];

  assert.equal(
    shouldForceMemoryAnswerTool("turn on woonkamer lights", memoryLines),
    false
  );
  assert.equal(
    shouldForceMemoryAnswerTool("can you turn on the woonkamer lights?", memoryLines),
    false
  );
});

test("shouldForceMemoryAnswerTool: does not override slash commands", () => {
  const memoryLines = ["- Woonkamer lights are Philips Hue."];
  assert.equal(
    shouldForceMemoryAnswerTool("/hue-instant-control make woonkamer cozy", memoryLines),
    false
  );
});

test("shouldForceMemoryAnswerTool: forces for question-like memory queries with overlap", () => {
  const memoryLines = ["- My wifi password is correcthorsebatterystaple."];
  assert.equal(shouldForceMemoryAnswerTool("what's the wifi password?", memoryLines), true);
  assert.equal(shouldForceMemoryAnswerTool("remind me the wifi password", memoryLines), true);
});

test("shouldForceMemoryAnswerTool: forces when explicitly asking about memory", () => {
  const memoryLines = ["- My wifi password is correcthorsebatterystaple."];
  assert.equal(
    shouldForceMemoryAnswerTool("do you remember my wifi password?", memoryLines),
    true
  );
});
