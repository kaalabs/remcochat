"use client";

import type {
  CreateHomeClientRootShellPropsInput,
  HomeClientMainColumnProps,
} from "@/app/home-client-shell-types";

export function createHomeClientMainColumnProps(
  input: CreateHomeClientRootShellPropsInput
): HomeClientMainColumnProps {
  return {
    composer: {
      attachmentUploadError: input.chatSession.attachmentUploadError,
      canManageActiveChat: input.canManageActiveChat,
      canSend: input.chatSession.canSend,
      chatRequestBodyAvailable: Boolean(input.chatSession.chatRequestBody),
      handleAttachmentCountChange: input.chatSession.handleAttachmentCountChange,
      handleAttachmentError: input.chatSession.handleAttachmentError,
      handleComposerKeyDown: input.chatSession.handleComposerKeyDown,
      handlePromptSubmit: input.chatSession.handlePromptSubmit,
      input: input.chatSession.input,
      isTemporaryChat: input.isTemporaryChat,
      messages: input.chatSession.messages,
      onOpenChatSettings: input.chatSettingsController.openChatSettings,
      onRegenerateLatest: input.chatSession.regenerateLatest,
      onSetInput: input.chatSession.setInput,
      onSetReasoningEffort: input.modelSelection.setReasoningEffort,
      onStop: input.chatSession.stop,
      reasoningEffort: input.modelSelection.reasoningEffort,
      reasoningOptions: input.modelSelection.reasoningOptions,
      selectedModelSupportsReasoning: Boolean(
        input.modelSelection.selectedModel?.capabilities?.reasoning
      ),
      showChatSettingsButton:
        !input.isTemporaryChat && Boolean(input.activeChat),
      status: input.chatSession.status,
      t: input.t,
      transcriptMaxWidthClass: input.chatColumnMaxWidthClass,
    },
    contentMaxWidthClass: input.chatColumnMaxWidthClass,
    header: {
      adminEnabled: input.adminEnabled,
      canManageActiveChat: input.canManageActiveChat,
      desktopSidebarCollapsed: input.desktopSidebarCollapsed,
      effectiveModelId: input.modelSelection.effectiveModelId,
      isTemporaryChat: input.isTemporaryChat,
      lanAdminAccessAllowed: input.lanAdminState.lanAdminAccess.allowed,
      lanAdminAccessEnabled: input.lanAdminAccessEnabled,
      lanAdminAccessHasToken: input.lanAdminState.lanAdminAccess.hasToken,
      modelOptions: input.modelSelection.modelOptions,
      onChangeModel: input.modelSelection.handleHeaderModelChange,
      onExpandDesktopSidebar: input.onExpandDesktopSidebar,
      onOpenLanAdmin: input.onOpenLanAdmin,
      onOpenSidebar: input.onOpenSidebar,
      onToggleTemporaryChat: input.onToggleTemporaryChat,
      t: input.t,
    },
    providersLoadError: input.modelSelection.providersLoadError,
    t: input.t,
    transcript: {
      activeProfileId: input.activeProfile?.id ?? "",
      activeProfileMemoryEnabled: Boolean(input.activeProfile?.memoryEnabled),
      addToolApprovalResponse: input.chatSession.addToolApprovalResponse,
      canRespondToMemoryPrompt:
        input.chatSession.status === "ready" &&
        Boolean(input.chatSession.chatRequestBody),
      emptyStateMessage: input.openingMessage,
      error: input.chatSession.error,
      isTemporaryChat: input.isTemporaryChat,
      messages: input.chatSession.messages,
      onOpenList: input.chatSession.sendOpenList,
      onRetryLatest: input.chatSession.retryLatest,
      onSendMemoryDecision: input.chatSession.sendMemoryDecision,
      onStartEditUserMessage: input.editForkController.startEditUserMessage,
      onStartMemorize: input.memorizeController.startMemorize,
      setMessages: input.chatSession.setMessages,
      setVariantsByUserMessageId: input.onSetVariantsByUserMessageId,
      showThinking: input.chatSession.showThinking,
      status: input.chatSession.status,
      stickToBottomContextRef: input.stickToBottomContextRef,
      t: input.t,
      transcriptMaxWidthClass: input.chatColumnMaxWidthClass,
      variantsByUserMessageId: input.variantsByUserMessageId,
    },
  };
}
