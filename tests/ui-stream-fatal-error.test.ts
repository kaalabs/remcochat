import assert from "node:assert/strict";
import { test } from "node:test";
import { createUIMessageStreamWithFatalErrorFallback } from "../src/server/ui-stream";

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

test("injects a text error when stream errors after start", async () => {
  let pullCount = 0;
  const source = new ReadableStream<Record<string, unknown>>({
    pull(controller) {
      if (pullCount === 0) {
        controller.enqueue({ type: "start", messageId: "m1" });
      } else {
        controller.error(new Error("boom"));
      }
      pullCount += 1;
    },
  });

  const wrapped = createUIMessageStreamWithFatalErrorFallback({
    stream: source,
    createMessageId: () => "generated",
    messageMetadata: { createdAt: "now" },
    errorTextFromError: () => "Injected error text",
  });

  const chunks = await readAll(wrapped);
  const types = chunks.map((c) => String((c as { type?: unknown }).type ?? ""));
  assert.deepEqual(types, ["start", "text-start", "text-delta", "text-end", "finish"]);
  assert.equal((chunks[2] as { delta?: unknown }).delta, "Injected error text");
});

test("injects start + text when stream errors before start", async () => {
  const source = new ReadableStream<Record<string, unknown>>({
    pull(controller) {
      controller.error(new Error("boom"));
    },
  });

  const wrapped = createUIMessageStreamWithFatalErrorFallback({
    stream: source,
    createMessageId: () => "m_generated",
    messageMetadata: { createdAt: "now" },
    errorTextFromError: () => "Injected error text",
  });

  const chunks = await readAll(wrapped);
  const types = chunks.map((c) => String((c as { type?: unknown }).type ?? ""));
  assert.deepEqual(types, ["start", "text-start", "text-delta", "text-end", "finish"]);
  assert.equal((chunks[0] as { messageId?: unknown }).messageId, "m_generated");
  assert.equal((chunks[2] as { delta?: unknown }).delta, "Injected error text");
});

test("converts error chunk into assistant text (no client error state)", async () => {
  const source = new ReadableStream<Record<string, unknown>>({
    start(controller) {
      controller.enqueue({ type: "start", messageId: "m1" });
      controller.enqueue({ type: "error", errorText: "Forbidden" });
      controller.close();
    },
  });

  const wrapped = createUIMessageStreamWithFatalErrorFallback({
    stream: source,
    createMessageId: () => "generated",
    messageMetadata: { createdAt: "now" },
    errorTextFromError: () => "Should not be used",
  });

  const chunks = await readAll(wrapped);
  const types = chunks.map((c) => String((c as { type?: unknown }).type ?? ""));
  assert.deepEqual(types, ["start", "text-start", "text-delta", "text-end", "finish"]);
  assert.equal((chunks[2] as { delta?: unknown }).delta, "Forbidden");
});
