import assert from "node:assert/strict";
import { test } from "node:test";
import { readUIMessageStream } from "ai";
import {
  collectUIMessageChunks,
  concatUIMessageStreams,
  createBufferedUIMessageStream,
  createUIMessageStreamWithDeferredContinuation,
  createUIMessageStreamWithToolErrorContinuation,
  stripUIMessageChunks,
  stripUIMessageStream,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

test("stripUIMessage* helpers prevent duplicate assistant messages when stitching continuations", async () => {
  const base: Chunk[] = [
    { type: "start", messageId: "m1" },
    {
      type: "tool-input-available",
      toolCallId: "tc_1",
      toolName: "ovNlGateway",
      input: { action: "trips.search", args: { from: "Almere Centrum", to: "Groningen" } },
    },
    {
      type: "tool-output-available",
      toolCallId: "tc_1",
      output: { kind: "trips.search", trips: [] },
    },
    { type: "finish", finishReason: "tool-calls" },
  ];

  const followup: Chunk[] = [
    { type: "start", messageId: "m2" },
    { type: "text-start", id: "m2" },
    { type: "text-delta", id: "m2", delta: "after" },
    { type: "text-end", id: "m2" },
    { type: "finish", finishReason: "stop" },
  ];

  const stitched = concatUIMessageStreams(
    stripUIMessageChunks(base, { dropFinish: true }),
    stripUIMessageStream(createBufferedUIMessageStream(followup), { dropStart: true })
  );

  const finalById = new Map<string, unknown>();
  for await (const msg of readUIMessageStream({ stream: stitched as ReadableStream<Chunk> })) {
    const candidate = msg as { id?: unknown };
    if (typeof candidate.id === "string") finalById.set(candidate.id, msg);
  }

  assert.equal(finalById.size, 1);
  const message = Array.from(finalById.values())[0] as { parts: Array<{ type: string; [key: string]: unknown }> };
  const toolParts = message.parts.filter((p) => p.type === "tool-ovNlGateway");
  const textParts = message.parts.filter((p) => p.type === "text");
  assert.equal(toolParts.length, 1);
  assert.ok(textParts.some((p) => String(p.text ?? "").includes("after")));
});

test("createUIMessageStreamWithDeferredContinuation forwards non-finish chunks without waiting for collection", async () => {
  const base: Chunk[] = [
    { type: "start", messageId: "m1" },
    { type: "text-delta", id: "m1", delta: "hello" },
    { type: "finish", finishReason: "stop" },
  ];

  const wrapped = createUIMessageStreamWithDeferredContinuation({
    stream: createBufferedUIMessageStream(base),
    collect: async (inspectionStream) => {
      await readAll(inspectionStream);
      await sleep(60);
      return { continue: false };
    },
    createContinuationStream: async () => null,
  });

  const reader = wrapped.getReader();
  const startedAt = Date.now();
  const first = await reader.read();
  const elapsedMs = Date.now() - startedAt;
  reader.releaseLock();

  assert.equal(first.done, false);
  assert.equal((first.value as Chunk).type, "start");
  assert.ok(elapsedMs < 40);
});

test("createUIMessageStreamWithDeferredContinuation defers base finish when appending continuation", async () => {
  const base: Chunk[] = [
    { type: "start", messageId: "m1" },
    { type: "text-delta", id: "m1", delta: "base" },
    { type: "finish", finishReason: "tool-calls" },
  ];
  const continuation: Chunk[] = [
    { type: "start", messageId: "m2" },
    { type: "text-delta", id: "m2", delta: "after" },
    { type: "finish", finishReason: "stop" },
  ];

  const wrapped = createUIMessageStreamWithDeferredContinuation({
    stream: createBufferedUIMessageStream(base),
    collect: async (inspectionStream) => {
      await readAll(inspectionStream);
      return { continue: true };
    },
    createContinuationStream: async () =>
      stripUIMessageStream(createBufferedUIMessageStream(continuation), { dropStart: true }),
  });

  const output = await readAll(wrapped);
  assert.deepEqual(
    output.map((chunk) => chunk.type),
    ["start", "text-delta", "text-delta", "finish"],
  );
  assert.equal(output[1].delta, "base");
  assert.equal(output[2].delta, "after");
});

test("collectUIMessageChunks can inspect without retaining chunks", async () => {
  const base: Chunk[] = [
    { type: "start", messageId: "m1" },
    { type: "tool-input-available", toolCallId: "tc_1", toolName: "ovNlGateway", input: {} },
    { type: "tool-output-available", toolCallId: "tc_1", output: { kind: "stations.search" } },
    { type: "finish", finishReason: "tool-calls" },
  ];

  const collected = await collectUIMessageChunks(createBufferedUIMessageStream(base), {
    isWebToolName: () => false,
    captureChunks: false,
    trackToolOutputsByName: ["ovNlGateway"],
  });

  assert.equal(collected.chunks.length, 0);
  const outputs = collected.toolOutputsByName.get("ovNlGateway") ?? [];
  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0], { kind: "stations.search" });
});
