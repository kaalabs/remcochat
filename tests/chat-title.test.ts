import assert from "node:assert/strict";
import { test } from "node:test";
import { validateChatTitle } from "../src/lib/chat-title";

test("validateChatTitle trims and accepts non-empty titles", () => {
  const res = validateChatTitle("  Hello world  ");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.title, "Hello world");
});

test("validateChatTitle rejects empty/whitespace-only titles", () => {
  const res = validateChatTitle("   ");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error, "Chat title cannot be empty.");
});

test("validateChatTitle rejects titles longer than 200 chars", () => {
  const res = validateChatTitle("a".repeat(201));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error, "Chat title is too long.");
});

