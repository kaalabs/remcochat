import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { nanoid } from "nanoid";
import {
  shouldContinueOvRecovery,
  shouldRetryOvAutoRecovery,
} from "@/lib/ov-nl-recovery";
import { runOvFromUserText } from "@/server/ov/runner";
import { logEvent } from "@/server/log";
import {
  collectUIMessageChunks,
  createUIMessageStreamWithDeferredContinuation,
  createUIMessageStreamWithFatalErrorFallback,
  createUIMessageStreamWithToolErrorContinuation,
  stripUIMessageStream,
} from "@/server/ui-stream";
import {
  fastPathContinuationMessageMetadata,
  formatOvFastPathRecoveryPrompt,
  isWebToolName,
  lastOvOutputFromMessages,
  ovConstraintNoMatchQuestion,
} from "@/server/chat/helpers";
import { uiTextResponse } from "@/server/chat/presenters";
import type {
  ChatMessage,
  StreamTextMessages,
  StreamTextModel,
  StreamTextProviderOptions,
  StreamTextToolSet,
} from "@/server/chat/types";

const OV_FAST_PATH_RECOVERY_RETRIES = 1;

function uiOvNlResponse(input: {
  command: { action: string; args?: Record<string, unknown> };
  executeOvGateway: (input: unknown) => Promise<unknown>;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
  recovery?: {
    userText: string;
    model: StreamTextModel;
    system: string;
    messages: StreamTextMessages;
    providerOptions?: StreamTextProviderOptions;
    sendReasoning: boolean;
    temperature?: number;
    ovTools: StreamTextToolSet;
  };
}) {
  const messageId = nanoid();
  const toolCallId = nanoid();
  const errorTextFromError = (err: unknown) =>
    err instanceof Error && err.message.trim()
      ? err.message
      : "Failed to continue OV recovery.";
  const baseStream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "ovNlGateway",
        input: {
          action: input.command.action,
          args: input.command.args ?? {},
        },
      });
      try {
        const output = await input.executeOvGateway({
          action: input.command.action,
          args: input.command.args ?? {},
        });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
        const noMatchQuestion = ovConstraintNoMatchQuestion(output);
        const shouldContinue = Boolean(
          input.recovery &&
            shouldContinueOvRecovery({
              finishReason: "tool-calls",
              lastOvOutput: output,
              hasTextDelta: Boolean(noMatchQuestion),
            })
        );
        if (noMatchQuestion) {
          writer.write({ type: "text-start", id: messageId });
          writer.write({
            type: "text-delta",
            id: messageId,
            delta: noMatchQuestion,
          });
          writer.write({ type: "text-end", id: messageId });
        }
        writer.write({
          type: "finish",
          finishReason: shouldContinue ? "tool-calls" : "stop",
          messageMetadata: input.messageMetadata,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to execute ovNlGateway.";
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText: message,
        });
        writer.write({ type: "text-start", id: messageId });
        writer.write({
          type: "text-delta",
          id: messageId,
          delta: `OV NL error: ${message}`,
        });
        writer.write({ type: "text-end", id: messageId });
        writer.write({
          type: "finish",
          finishReason: "stop",
          messageMetadata: input.messageMetadata,
        });
      }
    },
  });

  if (!input.recovery) {
    return createUIMessageStreamResponse({ stream: baseStream, headers: input.headers });
  }
  const recovery = input.recovery;

  const stream = createUIMessageStreamWithFatalErrorFallback({
    stream: createUIMessageStreamWithDeferredContinuation({
      stream: baseStream,
      collect: (inspectionStream) =>
        collectUIMessageChunks(inspectionStream, {
          isWebToolName,
          captureChunks: false,
          trackToolOutputsByName: ["ovNlGateway"],
        }),
      createContinuationStream: async (collected) => {
        const ovOutputs = collected.toolOutputsByName.get("ovNlGateway") ?? [];
        const lastOvOutput = ovOutputs.length > 0 ? ovOutputs[ovOutputs.length - 1] : null;
        if (
          !shouldContinueOvRecovery({
            finishReason: collected.finishReason,
            lastOvOutput,
            hasTextDelta: collected.hasTextDelta,
          })
        ) {
          return null;
        }

        const allowRetry = shouldRetryOvAutoRecovery({
          lastOvOutput,
          retriesRemaining: OV_FAST_PATH_RECOVERY_RETRIES,
          hasTextDelta: collected.hasTextDelta,
        });
        const continuationText = formatOvFastPathRecoveryPrompt({
          userText: recovery.userText,
          command: input.command,
          lastOvOutput,
          allowRetry,
          retriesRemaining: OV_FAST_PATH_RECOVERY_RETRIES,
        });
        const continuationMessages = recovery.messages.concat([
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: continuationText }],
          },
        ]);

        const continued = streamText({
          model: recovery.model,
          system: recovery.system,
          messages: continuationMessages,
          ...(allowRetry
            ? { tools: recovery.ovTools, toolChoice: "auto" as const }
            : { toolChoice: "none" as const }),
          ...(recovery.temperature !== undefined
            ? { temperature: recovery.temperature }
            : {}),
          ...(recovery.providerOptions
            ? { providerOptions: recovery.providerOptions }
            : {}),
          stopWhen: [stepCountIs(4)],
        });

        const continuedStream = continued.toUIMessageStream<
          UIMessage<RemcoChatMessageMetadata>
        >({
          generateMessageId: nanoid,
          messageMetadata: fastPathContinuationMessageMetadata(input.messageMetadata),
          sendReasoning: recovery.sendReasoning,
          onError: (err) =>
            err instanceof Error && err.message.trim()
              ? err.message
              : "Failed to continue OV recovery.",
        });
        const safeContinuedStream = createUIMessageStreamWithToolErrorContinuation({
          stream: continuedStream,
          shouldContinue: () => false,
          createContinuationStream: async () => null,
        });
        return stripUIMessageStream(safeContinuedStream, { dropStart: true });
      },
    }),
    createMessageId: nanoid,
    messageMetadata: input.messageMetadata,
    errorTextFromError,
  });

  return createUIMessageStreamResponse({ stream, headers: input.headers });
}

export async function tryOvIntentFastPath(input: {
  enabled: boolean;
  shouldTry: boolean;
  explicitSkillActivationOnly: boolean;
  executeOvGateway: ((input: unknown) => Promise<unknown>) | null;
  text: string;
  previousUserText: string;
  messages: ChatMessage[];
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
  recovery?: {
    model: StreamTextModel;
    system: string;
    messages: StreamTextMessages;
    providerOptions?: StreamTextProviderOptions;
    sendReasoning: boolean;
    temperature?: number;
    ovTools: StreamTextToolSet;
  };
}): Promise<Response | null> {
  if (!input.enabled) return null;
  if (!input.shouldTry) return null;
  if (input.explicitSkillActivationOnly) return null;
  if (typeof input.executeOvGateway !== "function") return null;

  const routed = await runOvFromUserText({
    text: input.text,
    context: {
      previousUserText: input.previousUserText,
      lastOvOutput: lastOvOutputFromMessages(input.messages),
    },
  });

  if (!routed.ok) {
    const confidence = typeof routed.confidence === "number" ? routed.confidence : 0;
    const missing = Array.isArray(routed.missing)
      ? routed.missing.map((m) => String(m ?? "").trim()).filter(Boolean)
      : [];
    const canClarifyFastPath =
      confidence >= 0.7 &&
      missing.some((slot) =>
        ["station", "from", "to", "from/to window", "ctxRecon"].includes(slot)
      );

    if (canClarifyFastPath && routed.clarification.trim()) {
      logEvent("info", "ov_intent_clarification", {
        reason: "missing_required",
        confidence,
        missing,
      });
      return uiTextResponse({
        text: routed.clarification.trim(),
        messageMetadata: input.messageMetadata,
        headers: input.headers,
      });
    }
    logEvent("info", "ov_intent_parse_failed", {
      reason: canClarifyFastPath ? "missing_required" : "parse_failed",
      confidence,
      missing,
    });
    return null;
  }

  logEvent("info", "ov_intent_parse_success", {
    action: routed.action,
    confidence: routed.confidence,
    isFollowUp: routed.isFollowUp,
  });
  return uiOvNlResponse({
    command: {
      action: routed.action,
      args: routed.args,
    },
    executeOvGateway: input.executeOvGateway,
    messageMetadata: input.messageMetadata,
    headers: input.headers,
    recovery: input.recovery
      ? {
          userText: input.text,
          model: input.recovery.model,
          system: input.recovery.system,
          messages: input.recovery.messages,
          providerOptions: input.recovery.providerOptions,
          sendReasoning: input.recovery.sendReasoning,
          temperature: input.recovery.temperature,
          ovTools: input.recovery.ovTools,
        }
      : undefined,
  });
}
