import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";

export function shouldAutoSubmitClientInteraction(input: {
  messages: UIMessage[];
}): boolean {
  if (lastAssistantMessageIsCompleteWithApprovalResponses(input)) {
    return true;
  }

  // RemcoChat's current tool loop is server-owned. A completed tool-call message
  // has already been advanced on the server via streamText stopWhen/prepareStep,
  // so the client must not generically resubmit it.
  if (lastAssistantMessageIsCompleteWithToolCalls(input)) {
    return false;
  }

  return false;
}
