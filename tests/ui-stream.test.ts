import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBufferedUIMessageStream,
  createUIMessageStreamWithToolErrorContinuation,
  type ToolStreamError,
} from "../src/server/ui-stream";

type Chunk = { type: string; [key: string]: unknown };

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const out: T[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return out;
}

test("createUIMessageStreamWithToolErrorContinuation appends continuation stream after tool-output-error", async () => {
  const initial: Chunk[] = [
    { type: "start", messageId: "m1" },
    {
      type: "tool-input-available",
      toolCallId: "tc_1",
      toolName: "displayNotes",
      input: { action: "show" },
    },
    { type: "tool-output-error", toolCallId: "tc_1", errorText: "boom" },
    { type: "finish", finishReason: "tool-calls" },
  ];

  let receivedErrors: ToolStreamError[] | null = null;
  const wrapped = createUIMessageStreamWithToolErrorContinuation({
    stream: createBufferedUIMessageStream<Chunk>(initial),
    shouldContinue: (errors) => errors.length > 0,
    createContinuationStream: async (errors) => {
      receivedErrors = errors;
      return createBufferedUIMessageStream([
        { type: "start", messageId: "m2" },
        { type: "text-delta", id: "m2", delta: "after" },
        { type: "finish", finishReason: "stop" },
      ]);
    },
  });

  const output = await readAll(wrapped);
  // +3 injected text chunks, +3 continuation chunks
  assert.equal(output.length, initial.length + 6);
  assert.equal(output[0].type, "start");
  assert.equal(output[1].type, "tool-input-available");
  assert.equal(output[2].type, "tool-output-error");
  assert.equal(output[3].type, "text-start");
  assert.equal(output[4].type, "text-delta");
  assert.match(String(output[4].delta ?? ""), /Tool error: boom/);
  assert.equal(output[5].type, "text-end");
  assert.equal(output[6].type, "finish");
  assert.equal(output[7].type, "start");
  assert.equal(output[8].type, "text-delta");
  assert.equal(output[8].delta, "after");

  assert.ok(receivedErrors);
  assert.equal(receivedErrors?.length, 1);
  assert.equal(receivedErrors?.[0]?.toolName, "displayNotes");
  assert.equal(receivedErrors?.[0]?.stage, "output");
  assert.equal(receivedErrors?.[0]?.errorText, "boom");
});

test("createUIMessageStreamWithToolErrorContinuation does not continue when no tool errors occurred", async () => {
  const initial: Chunk[] = [
    { type: "start", messageId: "m1" },
    {
      type: "tool-input-available",
      toolCallId: "tc_ok",
      toolName: "displayNotes",
      input: { action: "show" },
    },
    { type: "tool-output-available", toolCallId: "tc_ok", output: { ok: true } },
    { type: "finish", finishReason: "tool-calls" },
  ];

  let called = false;
  const wrapped = createUIMessageStreamWithToolErrorContinuation({
    stream: createBufferedUIMessageStream<Chunk>(initial),
    shouldContinue: (errors) => errors.length > 0,
    createContinuationStream: async () => {
      called = true;
      return null;
    },
  });

  const output = await readAll(wrapped);
  assert.equal(called, false);
  assert.equal(output.length, initial.length);
});

test("createUIMessageStreamWithToolErrorContinuation continues when finishReason is stop and a tool error occurred", async () => {
  const initial: Chunk[] = [
    { type: "start", messageId: "m1" },
    {
      type: "tool-input-available",
      toolCallId: "tc_2",
      toolName: "displayNotes",
      input: { action: "show" },
    },
    { type: "tool-output-error", toolCallId: "tc_2", errorText: "boom" },
    { type: "finish", finishReason: "stop" },
  ];

  let called = false;
  const wrapped = createUIMessageStreamWithToolErrorContinuation({
    stream: createBufferedUIMessageStream<Chunk>(initial),
    shouldContinue: () => true,
    createContinuationStream: async () => {
      called = true;
      return createBufferedUIMessageStream([
        { type: "start", messageId: "m3" },
        { type: "text-delta", id: "m3", delta: "continued" },
        { type: "finish", finishReason: "stop" },
      ]);
    },
  });

  const output = await readAll(wrapped);
  assert.equal(called, true);
  // +3 injected text chunks, +3 continuation chunks
  assert.equal(output.length, initial.length + 6);
  assert.equal(output[3].type, "text-start");
  assert.equal(output[4].type, "text-delta");
  assert.match(String(output[4].delta ?? ""), /Tool error: boom/);
  assert.equal(output[5].type, "text-end");
  assert.equal(output[7].type, "start");
  assert.equal(output[8].type, "text-delta");
  assert.equal(output[8].delta, "continued");
});
