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
  },
): Promise<{
  chunks: T[];
  webToolOutputs: Map<string, unknown>;
  toolErrors: ToolStreamError[];
  finishReason: unknown;
  hasUserVisibleOutput: boolean;
}> {
  const reader = stream.getReader();
  const chunks: T[] = [];
  const toolNamesByCallId = new Map<string, string>();
  const webToolOutputs = new Map<string, unknown>();
  const toolErrors: ToolStreamError[] = [];
  let finishReason: unknown = undefined;
  let hasUserVisibleOutput = false;
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
    chunks.push(value);

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
            chunks.push({ type: "text-start", id: activeMessageId } as T);
            chunks.push(
              { type: "text-delta", id: activeMessageId, delta: `Tool error: ${errorText}` } as T,
            );
            chunks.push({ type: "text-end", id: activeMessageId } as T);
          }
        }
        hasUserVisibleOutput = true;
      }
      continue;
    }

    if (
      (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta") &&
      typeof chunk.delta === "string"
    ) {
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

  return { chunks, webToolOutputs, toolErrors, finishReason, hasUserVisibleOutput };
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
