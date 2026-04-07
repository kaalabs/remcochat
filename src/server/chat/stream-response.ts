import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import {
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from "ai";
import { formatPerplexitySearchResultsForPrompt } from "@/ai/perplexity";
import {
  formatStdoutStderrExitCodeOutputsForPrompt,
  formatToolErrorsForPrompt,
  isWebToolName,
  shouldFinalizeAfterToolOnlyRun,
} from "@/server/chat/helpers";
import { formatLlmCallErrorForUser } from "@/server/llm-errors";
import { uiTextContinuationStream, uiTextResponse } from "@/server/chat/presenters";
import type {
  StreamTextMessages,
  StreamTextModel,
  StreamTextProviderOptions,
  StreamTextToolSet,
} from "@/server/chat/types";
import {
  collectUIMessageChunks,
  createUIMessageStreamWithDeferredContinuation,
  createUIMessageStreamWithFatalErrorFallback,
  createUIMessageStreamWithToolErrorContinuation,
  stripUIMessageStream,
} from "@/server/ui-stream";

type StreamTextResult = ReturnType<typeof streamText>;
type StreamTextOptions = Parameters<typeof streamText>[0];
type ToUIMessageStreamOptions = NonNullable<
  Parameters<StreamTextResult["toUIMessageStream"]>[0]
>;

export type ChatMessageMetadataFactory = ({
  part,
}: {
  part: Parameters<NonNullable<ToUIMessageStreamOptions["messageMetadata"]>>[0]["part"];
}) => RemcoChatMessageMetadata | undefined;

type PreparedToolLoop = {
  initialSystem: string;
  toolChoice?: StreamTextOptions["toolChoice"];
  stopWhen: StreamTextOptions["stopWhen"];
  prepareStep: StreamTextOptions["prepareStep"];
  experimental_repairToolCall: StreamTextOptions["experimental_repairToolCall"];
};

type ResolvedChatModel = {
  model: StreamTextModel;
  providerId: string;
  providerModelId: string;
  modelType: string;
  modelId: string;
  capabilities: {
    tools: boolean;
    reasoning: boolean;
    temperature: boolean;
  };
};

export function createChatStreamResponse(input: {
  headers: HeadersInit;
  result: StreamTextResult;
  createMessageId: () => string;
  messageMetadata: ChatMessageMetadataFactory;
  baseMessageMetadata: RemcoChatMessageMetadata;
  sendReasoning: boolean;
  errorTextFromError: (err: unknown) => string;
  inspectForContinuation: boolean;
  perplexitySearchEnabled: boolean;
  lastUserText: string;
  modelMessages: StreamTextMessages;
  system: string;
  model: StreamTextModel;
  providerOptions?: StreamTextProviderOptions;
  temperature?: number;
  allowBashToolOnlyFinalization: boolean;
}) {
  const toUIMessageStreamOptions: ToUIMessageStreamOptions = {
    generateMessageId: input.createMessageId,
    messageMetadata: input.messageMetadata,
    sendReasoning: input.sendReasoning,
    onError: input.errorTextFromError,
  };
  const baseUIStream = input.result.toUIMessageStream(toUIMessageStreamOptions);

  if (!input.inspectForContinuation) {
    return createUIMessageStreamResponse({
      headers: input.headers,
      stream: createUIMessageStreamWithFatalErrorFallback({
        stream: createUIMessageStreamWithToolErrorContinuation({
          stream: baseUIStream,
          shouldContinue: () => false,
          createContinuationStream: async () => null,
        }),
        createMessageId: input.createMessageId,
        messageMetadata: input.baseMessageMetadata,
        errorTextFromError: input.errorTextFromError,
      }),
    });
  }

  const continueWithTextOnlyPrompt = (promptText: string, safeToolErrors = false) => {
    const continuationMessages = input.modelMessages.concat([
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: promptText }],
      },
    ]);

    const continued = streamText({
      model: input.model,
      system: input.system,
      messages: continuationMessages,
      toolChoice: "none",
      ...(typeof input.temperature === "number"
        ? { temperature: input.temperature }
        : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      stopWhen: [stepCountIs(5)],
    });

    const continuedStream = continued.toUIMessageStream(toUIMessageStreamOptions);
    if (!safeToolErrors) {
      return stripUIMessageStream(continuedStream, { dropStart: true });
    }

    const safeContinuedStream = createUIMessageStreamWithToolErrorContinuation({
      stream: continuedStream,
      shouldContinue: () => false,
      createContinuationStream: async () => null,
    });
    return stripUIMessageStream(safeContinuedStream, { dropStart: true });
  };

  return createUIMessageStreamResponse({
    headers: input.headers,
    stream: createUIMessageStreamWithFatalErrorFallback({
      stream: createUIMessageStreamWithDeferredContinuation({
        stream: baseUIStream,
        collect: (inspectionStream) =>
          collectUIMessageChunks(inspectionStream, {
            isWebToolName,
            captureChunks: false,
            trackToolOutputsByName: ["obsidian", "bash"],
          }),
        createContinuationStream: async (collected) => {
          const perplexityOutput = collected.webToolOutputs.get("perplexity_search");
          const needsPerplexityContinuation =
            input.perplexitySearchEnabled &&
            collected.finishReason === "tool-calls" &&
            !collected.hasUserVisibleOutput &&
            perplexityOutput != null;

          if (!needsPerplexityContinuation) {
            const obsidianFinalization = shouldFinalizeAfterToolOnlyRun({
              finishReason: collected.finishReason,
              hasTextDelta: collected.hasTextDelta,
              toolErrors: collected.toolErrors,
              toolOutputsByName: collected.toolOutputsByName,
              toolName: "obsidian",
            });
            if (obsidianFinalization) {
              const formatted = formatStdoutStderrExitCodeOutputsForPrompt(
                obsidianFinalization.outputs,
              );
              return continueWithTextOnlyPrompt(
                [
                  "You ran the obsidian tool to read the user's daily notes.",
                  "Do not call any tools now. Write the final answer in plain text.",
                  "",
                  input.lastUserText ? `User request: ${input.lastUserText}` : "",
                  "Obsidian outputs (most recent calls):",
                  formatted,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              );
            }

            if (input.allowBashToolOnlyFinalization) {
              const bashFinalization = shouldFinalizeAfterToolOnlyRun({
                finishReason: collected.finishReason,
                hasTextDelta: collected.hasTextDelta,
                toolErrors: collected.toolErrors,
                toolOutputsByName: collected.toolOutputsByName,
                toolName: "bash",
              });
              if (bashFinalization) {
                const formatted = formatStdoutStderrExitCodeOutputsForPrompt(
                  bashFinalization.outputs,
                );
                return continueWithTextOnlyPrompt(
                  [
                    "You ran the bash tool.",
                    "Do not call any tools now. Write the final answer in plain text.",
                    "",
                    input.lastUserText ? `User request: ${input.lastUserText}` : "",
                    "Bash outputs (most recent calls):",
                    formatted,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                );
              }
            }

            if (collected.toolErrors.length === 0) return null;

            return continueWithTextOnlyPrompt(
              formatToolErrorsForPrompt(collected.toolErrors),
              true,
            );
          }

          const formatted = formatPerplexitySearchResultsForPrompt(perplexityOutput, {
            maxResults: 5,
            maxSnippetChars: 420,
          });

          if (!formatted.ok) {
            return uiTextContinuationStream({
              text: `Web search error: ${formatted.errorText}`,
              messageMetadata: input.baseMessageMetadata,
            });
          }

          return continueWithTextOnlyPrompt(
            [
              "Web search results (from perplexity_search). Use these to answer the user's last message. Include source URLs where relevant.",
              input.lastUserText ? `User question: ${input.lastUserText}` : "",
              formatted.text,
            ]
              .filter(Boolean)
              .join("\n\n"),
          );
        },
      }),
      createMessageId: input.createMessageId,
      messageMetadata: input.baseMessageMetadata,
      errorTextFromError: input.errorTextFromError,
    }),
  });
}

export function runChatStreamResponse(input: {
  headers: HeadersInit;
  resolvedModel: ResolvedChatModel;
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
  }>;
  system: string;
  toolLoop: PreparedToolLoop | null;
  streamTools?: StreamTextToolSet;
  modelMessages: StreamTextMessages;
  providerOptions?: StreamTextProviderOptions;
  temperature?: number;
  baseMessageMetadata: RemcoChatMessageMetadata;
  createMessageId: () => string;
  sendReasoning: boolean;
  lastUserText: string;
  perplexitySearchEnabled: boolean;
  allowBashToolOnlyFinalization: boolean;
}) {
  const providerInfo = input.providers.find(
    (provider) => provider.id === input.resolvedModel.providerId
  );
  const errorTextFromError = (err: unknown) => {
    console.error("LLM request failed", err);
    return formatLlmCallErrorForUser(err, {
      providerName: providerInfo?.name,
      providerId: input.resolvedModel.providerId,
      baseUrl: providerInfo?.baseUrl,
      modelType: input.resolvedModel.modelType,
      providerModelId: input.resolvedModel.providerModelId,
    });
  };

  const messageMetadata: ChatMessageMetadataFactory = ({ part }) => {
    if (part.type === "start") return input.baseMessageMetadata;
    if (part.type === "finish") {
      return {
        ...input.baseMessageMetadata,
        usage: part.totalUsage,
      };
    }
    return undefined;
  };

  let result: StreamTextResult;
  try {
    result = streamText({
      model: input.resolvedModel.model,
      system: input.toolLoop?.initialSystem ?? input.system,
      messages: input.modelMessages,
      ...(typeof input.temperature === "number"
        ? { temperature: input.temperature }
        : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      ...(input.resolvedModel.capabilities.tools && input.streamTools && input.toolLoop
        ? {
            ...(input.toolLoop.toolChoice
              ? { toolChoice: input.toolLoop.toolChoice }
              : {}),
            stopWhen: input.toolLoop.stopWhen,
            prepareStep: input.toolLoop.prepareStep,
            experimental_repairToolCall: input.toolLoop.experimental_repairToolCall,
            tools: input.streamTools,
          }
        : { stopWhen: [stepCountIs(5)] }),
    });
  } catch (err) {
    return uiTextResponse({
      headers: input.headers,
      text: errorTextFromError(err),
      messageMetadata: input.baseMessageMetadata,
    });
  }

  return createChatStreamResponse({
    headers: input.headers,
    result,
    createMessageId: input.createMessageId,
    messageMetadata,
    baseMessageMetadata: input.baseMessageMetadata,
    sendReasoning: input.sendReasoning,
    errorTextFromError,
    inspectForContinuation:
      input.resolvedModel.capabilities.tools || input.perplexitySearchEnabled,
    perplexitySearchEnabled: input.perplexitySearchEnabled,
    lastUserText: input.lastUserText,
    modelMessages: input.modelMessages,
    system: input.system,
    model: input.resolvedModel.model,
    providerOptions: input.providerOptions,
    temperature: input.temperature,
    allowBashToolOnlyFinalization: input.allowBashToolOnlyFinalization,
  });
}
