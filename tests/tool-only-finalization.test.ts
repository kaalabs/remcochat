import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolStreamError } from "../src/server/ui-stream";
import { shouldFinalizeAfterToolOnlyRun } from "../src/server/chat/helpers";

test("shouldFinalizeAfterToolOnlyRun: triggers when stream stops after tool-only run", () => {
  const toolOutputsByName = new Map<string, unknown[]>();
  toolOutputsByName.set("obsidian", [
    { stdout: "note 1", stderr: "", exitCode: 0 },
    { stdout: "note 2", stderr: "", exitCode: 0 },
  ]);

  const result = shouldFinalizeAfterToolOnlyRun({
    finishReason: "stop",
    hasTextDelta: false,
    toolErrors: [],
    toolOutputsByName,
    toolName: "obsidian",
  });

  assert.ok(result);
  assert.equal(result?.outputs.length, 2);
});

test("shouldFinalizeAfterToolOnlyRun: works for bash tool outputs too", () => {
  const toolOutputsByName = new Map<string, unknown[]>();
  toolOutputsByName.set("bash", [{ stdout: "hello\n", stderr: "", exitCode: 0 }]);

  const result = shouldFinalizeAfterToolOnlyRun({
    finishReason: "tool-calls",
    hasTextDelta: false,
    toolErrors: [],
    toolOutputsByName,
    toolName: "bash",
  });

  assert.ok(result);
  assert.equal(result?.outputs.length, 1);
});

test("shouldFinalizeAfterToolOnlyRun: does not trigger when assistant text exists", () => {
  const toolOutputsByName = new Map<string, unknown[]>();
  toolOutputsByName.set("obsidian", [{ stdout: "note", exitCode: 0 }]);

  const result = shouldFinalizeAfterToolOnlyRun({
    finishReason: "stop",
    hasTextDelta: true,
    toolErrors: [],
    toolOutputsByName,
    toolName: "obsidian",
  });

  assert.equal(result, null);
});

test("shouldFinalizeAfterToolOnlyRun: does not trigger when tool errors occurred", () => {
  const toolOutputsByName = new Map<string, unknown[]>();
  toolOutputsByName.set("obsidian", [{ stdout: "note", exitCode: 0 }]);

  const toolErrors: ToolStreamError[] = [
    { toolCallId: "tc1", toolName: "obsidian", stage: "output", errorText: "boom" },
  ];

  const result = shouldFinalizeAfterToolOnlyRun({
    finishReason: "stop",
    hasTextDelta: false,
    toolErrors,
    toolOutputsByName,
    toolName: "obsidian",
  });

  assert.equal(result, null);
});

test("shouldFinalizeAfterToolOnlyRun: does not trigger on unrelated finish reasons", () => {
  const toolOutputsByName = new Map<string, unknown[]>();
  toolOutputsByName.set("obsidian", [{ stdout: "note", exitCode: 0 }]);

  const result = shouldFinalizeAfterToolOnlyRun({
    finishReason: "length",
    hasTextDelta: false,
    toolErrors: [],
    toolOutputsByName,
    toolName: "obsidian",
  });

  assert.equal(result, null);
});
