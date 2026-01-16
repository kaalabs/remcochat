import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeNoteContent, splitNoteContent } from "../src/lib/notes";

test("normalizeNoteContent trims and normalizes whitespace", () => {
  const input = "  Line one\r\n\r\n\r\nLine two  \n";
  const output = normalizeNoteContent(input);
  assert.equal(output, "Line one\n\nLine two");
});

test("splitNoteContent returns title and body", () => {
  const content = "Title line\nSecond line\nThird line";
  const parts = splitNoteContent(content);
  assert.equal(parts.title, "Title line");
  assert.equal(parts.body, "Second line\nThird line");
});
