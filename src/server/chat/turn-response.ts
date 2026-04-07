import { convertToModelMessages } from "ai";
import type { ToolBundle } from "@/ai/tool-bundle";
import { replaceAttachmentPartsWithExtractedText } from "@/server/attachment-prompt";
import { runChatStreamResponse } from "@/server/chat/stream-response";
import type { ChatMessage } from "@/server/chat/types";

type RunChatStreamResponseInput = Parameters<typeof runChatStreamResponse>[0];

export async function prepareChatModelMessages(input: {
  profileId: string;
  messages: ChatMessage[];
}) {
  const withAttachments = await replaceAttachmentPartsWithExtractedText({
    profileId: input.profileId,
    messages: input.messages,
  });
  return await convertToModelMessages(withAttachments, {
    ignoreIncompleteToolCalls: true,
  });
}

export function formatAttachmentProcessingError(err: unknown) {
  return err instanceof Error
    ? `Attachment processing error: ${err.message}`
    : "Attachment processing error.";
}

export function isPerplexitySearchEnabled(webTools: ToolBundle) {
  return (
    webTools.enabled &&
    Object.prototype.hasOwnProperty.call(webTools.tools, "perplexity_search")
  );
}

export function runPreparedChatStreamResponse(
  input: Omit<
    RunChatStreamResponseInput,
    "perplexitySearchEnabled" | "allowBashToolOnlyFinalization"
  > & {
    webTools: ToolBundle;
    explicitBashCommandFromUser: string | null;
  },
) {
  return runChatStreamResponse({
    ...input,
    perplexitySearchEnabled: isPerplexitySearchEnabled(input.webTools),
    allowBashToolOnlyFinalization: !input.explicitBashCommandFromUser,
  });
}
