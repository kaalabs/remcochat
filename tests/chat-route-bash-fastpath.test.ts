import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractExplicitBashCommand,
  shouldAllowDirectBashFastPath,
} from "../src/app/api/chat/route";

test("extractExplicitBashCommand: accepts explicit /bash command", () => {
  assert.equal(extractExplicitBashCommand("/bash npm test"), "npm test");
});

test("extractExplicitBashCommand: accepts explicit bash: prefix", () => {
  assert.equal(extractExplicitBashCommand("bash: ls -la"), "ls -la");
});

test("extractExplicitBashCommand: rejects question-like prompts", () => {
  assert.equal(extractExplicitBashCommand("How do I run `npm test`?"), null);
  assert.equal(extractExplicitBashCommand("Can you run `ls -la`?"), null);
});

test("extractExplicitBashCommand: requires strong opt-in for markdown commands", () => {
  assert.equal(extractExplicitBashCommand("run `npm test`"), null);
  assert.equal(
    extractExplicitBashCommand("Please run this command: `npm test`"),
    "npm test"
  );
});

test("shouldAllowDirectBashFastPath: only true for explicit fastpath intents", () => {
  assert.equal(shouldAllowDirectBashFastPath("/bash ls"), true);
  assert.equal(shouldAllowDirectBashFastPath("bash: ls -la"), true);
  assert.equal(
    shouldAllowDirectBashFastPath("Please run this command and do not add any other text: `ls -la`"),
    true
  );
  assert.equal(shouldAllowDirectBashFastPath("How do I run `npm test`?"), false);
  assert.equal(shouldAllowDirectBashFastPath("run `npm test`"), false);
});
