import type { ToolBundle } from "@/ai/tool-bundle";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import {
  prepareChatExecutionArtifacts,
} from "@/server/chat/chat-runtime";
import {
  uiTextResponse,
} from "@/server/chat/presenters";
import {
  prepareChatToolingRuntime,
} from "@/server/chat/tool-runtime";
import {
  formatAttachmentProcessingError,
  runPreparedChatStreamResponse,
} from "@/server/chat/turn-response";

type PreparedExecutionArtifacts = Awaited<
  ReturnType<typeof prepareChatExecutionArtifacts>
>;
type PreparedToolingRuntime = Awaited<
  ReturnType<typeof prepareChatToolingRuntime>
>;
type SuccessfulToolingRuntime = Extract<
  PreparedToolingRuntime,
  { response: null }
>;
type PreparedStreamInput = Omit<
  Parameters<typeof runPreparedChatStreamResponse>[0],
  "system" | "toolLoop" | "streamTools" | "modelMessages" | "temperature"
> & {
  webTools: ToolBundle;
  explicitBashCommandFromUser: string | null;
};

type ExecutePreparedChatTurnDeps = {
  prepareExecutionArtifactsImpl?: typeof prepareChatExecutionArtifacts;
  prepareToolingRuntimeImpl?: typeof prepareChatToolingRuntime;
  runPreparedChatStreamResponseImpl?: typeof runPreparedChatStreamResponse;
};

export async function executePreparedChatTurn(
  input: {
    execution: Parameters<typeof prepareChatExecutionArtifacts>[0];
    attachmentError: {
      headers: HeadersInit;
      messageMetadata?: RemcoChatMessageMetadata;
    };
    createToolingInput: (
      artifacts: PreparedExecutionArtifacts,
    ) => Parameters<typeof prepareChatToolingRuntime>[0];
    createStreamInput: (
      artifacts: PreparedExecutionArtifacts,
      toolingRuntime: SuccessfulToolingRuntime,
    ) => PreparedStreamInput;
  },
  deps: ExecutePreparedChatTurnDeps = {},
): Promise<Response> {
  const prepareExecutionArtifacts =
    deps.prepareExecutionArtifactsImpl ?? prepareChatExecutionArtifacts;
  const prepareToolingRuntime =
    deps.prepareToolingRuntimeImpl ?? prepareChatToolingRuntime;
  const runStreamResponse =
    deps.runPreparedChatStreamResponseImpl ?? runPreparedChatStreamResponse;

  let executionArtifacts: PreparedExecutionArtifacts;
  try {
    executionArtifacts = await prepareExecutionArtifacts(input.execution);
  } catch (err) {
    return uiTextResponse({
      headers: input.attachmentError.headers,
      text: formatAttachmentProcessingError(err),
      messageMetadata: input.attachmentError.messageMetadata,
    });
  }

  const toolingRuntime = await prepareToolingRuntime(
    input.createToolingInput(executionArtifacts),
  );
  if (toolingRuntime.response) return toolingRuntime.response;

  return runStreamResponse({
    ...input.createStreamInput(executionArtifacts, toolingRuntime),
    system: executionArtifacts.system,
    toolLoop: toolingRuntime.toolLoop,
    streamTools: toolingRuntime.streamTools,
    modelMessages: executionArtifacts.modelMessages,
    temperature: executionArtifacts.temperature,
  });
}
