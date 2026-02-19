export type ToolStreamError = {
  toolCallId: string;
  toolName?: string;
  stage: "input" | "output";
  errorText: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function safeErrorText(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  return fallback;
}

function isChunkType(value: unknown, type: string): boolean {
  if (!isRecord(value)) return false;
  return value.type === type;
}

export function stripUIMessageChunks<T>(
  chunks: T[],
  opts: { dropStart?: boolean; dropFinish?: boolean }
): T[] {
  const dropStart = Boolean(opts.dropStart);
  const dropFinish = Boolean(opts.dropFinish);
  if (!dropStart && !dropFinish) return chunks;

  return chunks.filter((chunk) => {
    const value = chunk as unknown;
    if (dropStart && isChunkType(value, "start")) return false;
    if (dropFinish && isChunkType(value, "finish")) return false;
    return true;
  });
}

export function stripUIMessageStream<T>(
  stream: ReadableStream<T>,
  opts: { dropStart?: boolean; dropFinish?: boolean }
): ReadableStream<T> {
  const dropStart = Boolean(opts.dropStart);
  const dropFinish = Boolean(opts.dropFinish);
  if (!dropStart && !dropFinish) return stream;

  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        const value = chunk as unknown;
        if (dropStart && isChunkType(value, "start")) return;
        if (dropFinish && isChunkType(value, "finish")) return;
        controller.enqueue(chunk);
      },
    })
  );
}

export function createBufferedUIMessageStream<T>(chunks: T[]): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

export function concatUIMessageStreams<T>(
  prefixChunks: T[],
  suffix: ReadableStream<T>,
): ReadableStream<T> {
  return new ReadableStream({
    async start(controller) {
      for (const chunk of prefixChunks) controller.enqueue(chunk);
      const reader = suffix.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export async function collectUIMessageChunks<T>(
  stream: ReadableStream<T>,
  opts: {
    isWebToolName: (toolName: string) => boolean;
    maxToolErrors?: number;
    captureChunks?: boolean;
    trackToolOutputsByName?: string[];
  },
): Promise<{
  chunks: T[];
  webToolOutputs: Map<string, unknown>;
  toolOutputsByName: Map<string, unknown[]>;
  toolErrors: ToolStreamError[];
  finishReason: unknown;
  hasUserVisibleOutput: boolean;
  hasTextDelta: boolean;
}> {
  const reader = stream.getReader();
  const captureChunks = opts.captureChunks !== false;
  const chunks: T[] = [];
  const trackedToolNames = new Set(
    (opts.trackToolOutputsByName ?? []).filter((name) => typeof name === "string" && name.trim()),
  );
  const toolNamesByCallId = new Map<string, string>();
  const webToolOutputs = new Map<string, unknown>();
  const toolOutputsByName = new Map<string, unknown[]>();
  const toolErrors: ToolStreamError[] = [];
  let finishReason: unknown = undefined;
  let hasUserVisibleOutput = false;
  let hasTextDelta = false;
  let activeMessageId: string | null = null;
  let sawAnyText = false;
  let injectedErrorText = false;

  const maxToolErrors = Math.max(1, Math.floor(opts.maxToolErrors ?? 5));
  const pushToolError = (error: ToolStreamError) => {
    if (toolErrors.length >= maxToolErrors) return;
    toolErrors.push(error);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (captureChunks) chunks.push(value);

    const chunk = value as unknown;
    if (!isRecord(chunk)) continue;

    if (chunk?.type === "start" && typeof chunk.messageId === "string") {
      activeMessageId = chunk.messageId;
      continue;
    }

    if (chunk?.type === "text-start" || chunk?.type === "text-delta") {
      sawAnyText = true;
    }

    if (
      chunk?.type === "tool-input-start" ||
      chunk?.type === "tool-input-available" ||
      chunk?.type === "tool-input-error"
    ) {
      if (typeof chunk.toolCallId === "string" && typeof chunk.toolName === "string") {
        toolNamesByCallId.set(chunk.toolCallId, chunk.toolName);
      }

      if (chunk?.type === "tool-input-error" && typeof chunk.toolCallId === "string") {
        const toolName = toolNamesByCallId.get(chunk.toolCallId);
        const errorText = safeErrorText(
          chunk.errorText,
          "Tool input error.",
        );
        pushToolError({
          toolCallId: chunk.toolCallId,
          toolName,
          stage: "input",
          errorText,
        });

        if (activeMessageId && !sawAnyText && !injectedErrorText) {
          injectedErrorText = true;
          if (captureChunks) {
            chunks.push({ type: "text-start", id: activeMessageId } as T);
            chunks.push(
              {
                type: "text-delta",
                id: activeMessageId,
                delta: `Tool error: ${errorText}`,
              } as T,
            );
            chunks.push({ type: "text-end", id: activeMessageId } as T);
          }
        }

        if (toolName && opts.isWebToolName(toolName)) {
          webToolOutputs.set(toolName, { error: "input", message: errorText });
        } else {
          hasUserVisibleOutput = true;
        }
      }
      continue;
    }

    if (chunk?.type === "tool-output-available" || chunk?.type === "tool-output-error") {
      const toolName =
        typeof chunk.toolCallId === "string"
          ? toolNamesByCallId.get(chunk.toolCallId)
          : undefined;

      if (toolName && opts.isWebToolName(toolName)) {
        if (chunk.type === "tool-output-available") {
          webToolOutputs.set(toolName, chunk.output);
        } else {
          const errorText = safeErrorText(chunk.errorText, "Web tool failed.");
          webToolOutputs.set(toolName, { error: "unknown", message: errorText });
          if (typeof chunk.toolCallId === "string") {
            pushToolError({
              toolCallId: chunk.toolCallId,
              toolName,
              stage: "output",
              errorText,
            });
          }
        }
      } else {
        if (chunk.type === "tool-output-error" && typeof chunk.toolCallId === "string") {
          const errorText = safeErrorText(chunk.errorText, "Tool failed.");
          pushToolError({
            toolCallId: chunk.toolCallId,
            toolName,
            stage: "output",
            errorText,
          });

          if (activeMessageId && !sawAnyText && !injectedErrorText) {
            injectedErrorText = true;
            if (captureChunks) {
              chunks.push({ type: "text-start", id: activeMessageId } as T);
              chunks.push(
                { type: "text-delta", id: activeMessageId, delta: `Tool error: ${errorText}` } as T,
              );
              chunks.push({ type: "text-end", id: activeMessageId } as T);
            }
          }
        }
        hasUserVisibleOutput = true;
      }

      if (
        chunk.type === "tool-output-available" &&
        typeof chunk.toolCallId === "string" &&
        toolName &&
        trackedToolNames.has(toolName)
      ) {
        const list = toolOutputsByName.get(toolName);
        if (list) {
          list.push(chunk.output);
        } else {
          toolOutputsByName.set(toolName, [chunk.output]);
        }
      }
      continue;
    }

    if (
      (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta") &&
      typeof chunk.delta === "string"
    ) {
      if (chunk?.type === "text-delta" && chunk.delta.trim().length > 0) {
        hasTextDelta = true;
      }
      if (chunk.delta.length > 0) hasUserVisibleOutput = true;
      continue;
    }

    if (chunk?.type === "error") {
      hasUserVisibleOutput = true;
      continue;
    }

    if (chunk?.type === "finish") {
      finishReason = chunk.finishReason;
      continue;
    }
  }

  return {
    chunks,
    webToolOutputs,
    toolOutputsByName,
    toolErrors,
    finishReason,
    hasUserVisibleOutput,
    hasTextDelta,
  };
}

export function createUIMessageStreamWithDeferredContinuation<T, C>(input: {
  stream: ReadableStream<T>;
  collect: (inspectionStream: ReadableStream<T>) => Promise<C>;
  createContinuationStream: (collected: C) => Promise<ReadableStream<T> | null>;
}): ReadableStream<T> {
  const [clientStream, inspectionStream] = input.stream.tee();
  const collectedPromise = input.collect(inspectionStream);

  return new ReadableStream({
    async start(controller) {
      const reader = clientStream.getReader();
      const deferredFinishChunks: T[] = [];

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (isChunkType(value as unknown, "finish")) {
            deferredFinishChunks.push(value);
            continue;
          }
          controller.enqueue(value);
        }

        const collected = await collectedPromise;
        const continuation = await input.createContinuationStream(collected);

        if (continuation) {
          const continuationReader = continuation.getReader();
          try {
            while (true) {
              const { value, done } = await continuationReader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } finally {
            continuationReader.releaseLock();
          }
        } else {
          for (const finishChunk of deferredFinishChunks) {
            controller.enqueue(finishChunk);
          }
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export function createUIMessageStreamWithToolErrorContinuation<T>(input: {
  stream: ReadableStream<T>;
  shouldContinue: (toolErrors: ToolStreamError[]) => boolean;
  createContinuationStream: (
    toolErrors: ToolStreamError[],
  ) => Promise<ReadableStream<T> | null>;
  maxToolErrors?: number;
}): ReadableStream<T> {
  return new ReadableStream({
    async start(controller) {
      const reader = input.stream.getReader();
      const toolNamesByCallId = new Map<string, string>();
      const toolErrors: ToolStreamError[] = [];
      let activeMessageId: string | null = null;
      let sawAnyText = false;
      let injectedErrorText = false;

      const maxToolErrors = Math.max(1, Math.floor(input.maxToolErrors ?? 5));
      const pushToolError = (error: ToolStreamError) => {
        if (toolErrors.length >= maxToolErrors) return;
        toolErrors.push(error);
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);

          const chunk = value as unknown;
          if (!isRecord(chunk)) continue;

          if (chunk?.type === "start" && typeof chunk.messageId === "string") {
            activeMessageId = chunk.messageId;
            continue;
          }

          if (
            (chunk?.type === "text-delta" || chunk?.type === "text-start") &&
            typeof activeMessageId === "string"
          ) {
            sawAnyText = true;
            continue;
          }

          if (
            chunk?.type === "tool-input-start" ||
            chunk?.type === "tool-input-available" ||
            chunk?.type === "tool-input-error"
          ) {
            if (
              typeof chunk.toolCallId === "string" &&
              typeof chunk.toolName === "string"
            ) {
              toolNamesByCallId.set(chunk.toolCallId, chunk.toolName);
            }

            if (chunk?.type === "tool-input-error" && typeof chunk.toolCallId === "string") {
              const toolName = toolNamesByCallId.get(chunk.toolCallId);
              pushToolError({
                toolCallId: chunk.toolCallId,
                toolName,
                stage: "input",
                errorText: safeErrorText(chunk.errorText, "Tool input error."),
              });

              if (activeMessageId && !sawAnyText && !injectedErrorText) {
                injectedErrorText = true;
                controller.enqueue({ type: "text-start", id: activeMessageId } as T);
                controller.enqueue(
                  {
                    type: "text-delta",
                    id: activeMessageId,
                    delta: `Tool error: ${safeErrorText(
                      chunk.errorText,
                      "Tool input error.",
                    )}`,
                  } as T,
                );
                controller.enqueue({ type: "text-end", id: activeMessageId } as T);
              }
            }

            continue;
          }

          if (chunk?.type === "tool-output-error" && typeof chunk.toolCallId === "string") {
            const toolName = toolNamesByCallId.get(chunk.toolCallId);
            const errorText = safeErrorText(chunk.errorText, "Tool failed.");
            pushToolError({
              toolCallId: chunk.toolCallId,
              toolName,
              stage: "output",
              errorText,
            });

            if (activeMessageId && !sawAnyText && !injectedErrorText) {
              injectedErrorText = true;
              controller.enqueue({ type: "text-start", id: activeMessageId } as T);
              controller.enqueue(
                { type: "text-delta", id: activeMessageId, delta: `Tool error: ${errorText}` } as T,
              );
              controller.enqueue({ type: "text-end", id: activeMessageId } as T);
            }
            continue;
          }

          if (chunk?.type === "finish" || chunk?.type === "error") continue;
        }

        const shouldTryContinuation =
          toolErrors.length > 0 && input.shouldContinue(toolErrors);

        if (shouldTryContinuation) {
          const continuation = await input.createContinuationStream(toolErrors);
          if (continuation) {
            const continuationReader = continuation.getReader();
            try {
              while (true) {
                const { value, done } = await continuationReader.read();
                if (done) break;
                controller.enqueue(value);
              }
            } finally {
              continuationReader.releaseLock();
            }
          }
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function isAbortLikeError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const name = (err as { name?: unknown }).name;
    if (name === "AbortError") return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("aborted")) return true;
    if (msg.includes("aborterror")) return true;
    if (msg.includes("cancelled")) return true;
    if (msg.includes("canceled")) return true;
  }
  return false;
}

export function createUIMessageStreamWithFatalErrorFallback<T>(input: {
  stream: ReadableStream<T>;
  createMessageId: () => string;
  messageMetadata?: unknown;
  errorTextFromError: (err: unknown) => string;
}): ReadableStream<T> {
  return new ReadableStream({
    async start(controller) {
      const reader = input.stream.getReader();
      let activeMessageId: string | null = null;
      let injectedErrorText = false;
      let sawFinish = false;
      let openTextId: string | null = null;

      const injectErrorText = (text: string) => {
        if (injectedErrorText) return;
        injectedErrorText = true;

        const messageId = activeMessageId ?? input.createMessageId();
        if (!activeMessageId) {
          controller.enqueue(
            { type: "start", messageId, messageMetadata: input.messageMetadata } as T,
          );
          activeMessageId = messageId;
        }

        const normalized = text.trim() || "Request failed.";
        if (openTextId) {
          controller.enqueue(
            { type: "text-delta", id: openTextId, delta: `\n\n${normalized}` } as T,
          );
          controller.enqueue({ type: "text-end", id: openTextId } as T);
          openTextId = null;
        } else {
          controller.enqueue({ type: "text-start", id: messageId } as T);
          controller.enqueue({ type: "text-delta", id: messageId, delta: normalized } as T);
          controller.enqueue({ type: "text-end", id: messageId } as T);
        }
        controller.enqueue(
          { type: "finish", finishReason: "stop", messageMetadata: input.messageMetadata } as T,
        );
        sawFinish = true;
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = value as unknown;
          if (isRecord(chunk)) {
            if (chunk?.type === "start" && typeof chunk.messageId === "string") {
              activeMessageId = chunk.messageId;
            }
            if (chunk?.type === "text-start" && typeof chunk.id === "string") {
              openTextId = chunk.id;
            }
            if (chunk?.type === "text-end" && typeof chunk.id === "string") {
              if (openTextId === chunk.id) openTextId = null;
            }

            if (chunk?.type === "finish") {
              sawFinish = true;
              controller.enqueue(value);
              continue;
            }

            if (chunk?.type === "error" && typeof chunk.errorText === "string") {
              injectErrorText(chunk.errorText);
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              break;
            }
          }

          controller.enqueue(value);
        }

        controller.close();
      } catch (err) {
        if (isAbortLikeError(err)) {
          controller.close();
        } else {
          if (!sawFinish) injectErrorText(input.errorTextFromError(err));
          controller.close();
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}
