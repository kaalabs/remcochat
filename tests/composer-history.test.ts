import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type PromptHistoryMessage,
  extractPromptHistory,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  navigatePromptHistory,
} from "../src/lib/composer-history";

test("extractPromptHistory returns trimmed-nonempty user prompt texts", () => {
  const messages: PromptHistoryMessage[] = [
    { role: "user", parts: [{ type: "text", text: "first" }] },
    { role: "assistant", parts: [{ type: "text", text: "ignored" }] },
    { role: "user", parts: [{ type: "text", text: "   " }] },
    { role: "user", parts: [{ type: "file" }] },
    {
      role: "user",
      parts: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    },
  ];

  assert.deepEqual(extractPromptHistory(messages), ["first", "ab"]);
});

test("caret helpers detect first/last line boundaries", () => {
  const value = "one\ntwo\nthree";

  assert.equal(isCaretOnFirstLine(value, 0), true);
  assert.equal(isCaretOnFirstLine(value, 3), true);
  assert.equal(isCaretOnFirstLine(value, 4), false);

  assert.equal(isCaretOnLastLine(value, 0), false);
  assert.equal(isCaretOnLastLine(value, value.length), true);
  assert.equal(isCaretOnLastLine(value, value.indexOf("two")), false);
});

test("navigatePromptHistory walks backward/forward and restores draft", () => {
  const history = ["a", "b"];

  const up1 = navigatePromptHistory({
    direction: "up",
    history,
    cursor: 2,
    draft: "",
    value: "draft",
  });
  assert.equal(up1.didNavigate, true);
  assert.equal(up1.cursor, 1);
  assert.equal(up1.draft, "draft");
  assert.equal(up1.value, "b");

  const up2 = navigatePromptHistory({
    direction: "up",
    history,
    cursor: up1.cursor,
    draft: up1.draft,
    value: up1.value,
  });
  assert.equal(up2.didNavigate, true);
  assert.equal(up2.cursor, 0);
  assert.equal(up2.value, "a");

  const up3 = navigatePromptHistory({
    direction: "up",
    history,
    cursor: up2.cursor,
    draft: up2.draft,
    value: up2.value,
  });
  assert.equal(up3.didNavigate, false);
  assert.equal(up3.cursor, 0);

  const down1 = navigatePromptHistory({
    direction: "down",
    history,
    cursor: up2.cursor,
    draft: up2.draft,
    value: up2.value,
  });
  assert.equal(down1.didNavigate, true);
  assert.equal(down1.cursor, 1);
  assert.equal(down1.value, "b");

  const down2 = navigatePromptHistory({
    direction: "down",
    history,
    cursor: down1.cursor,
    draft: down1.draft,
    value: down1.value,
  });
  assert.equal(down2.didNavigate, true);
  assert.equal(down2.cursor, 2);
  assert.equal(down2.value, "draft");
});

test("navigatePromptHistory clamps out-of-range cursors", () => {
  const history = ["a", "b"];
  const res = navigatePromptHistory({
    direction: "up",
    history,
    cursor: 999,
    draft: "",
    value: "draft",
  });
  assert.equal(res.didNavigate, true);
  assert.equal(res.cursor, 1);
  assert.equal(res.value, "b");
});

test("navigatePromptHistory no-ops when history is empty", () => {
  const res = navigatePromptHistory({
    direction: "up",
    history: [],
    cursor: 0,
    draft: "",
    value: "draft",
  });
  assert.equal(res.didNavigate, false);
  assert.equal(res.cursor, 0);
  assert.equal(res.value, "draft");
});
