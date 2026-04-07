"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";
import type { Profile } from "@/domain/profiles/types";
import type { ModelOption } from "@/lib/models";

import {
  useHomeClientChatActions,
} from "@/app/home-client-chat-actions";
import {
  useHomeClientChatBootstrap,
} from "@/app/home-client-chat-bootstrap";
import {
  useHomeClientChatSession,
} from "@/app/home-client-chat-session";
import {
  useHomeClientChatSettings,
} from "@/app/home-client-chat-settings";
import {
  useHomeClientChatStateSync,
} from "@/app/home-client-chat-state-sync";
import {
  useHomeClientEditFork,
} from "@/app/home-client-edit-fork";
import {
  useHomeClientLanAdmin,
} from "@/app/home-client-lan-admin";
import {
  useHomeClientModelSelection,
} from "@/app/home-client-model-selection";
import {
  useHomeClientProfileSelection,
} from "@/app/home-client-profile-selection";
import type { useHomeClientAppState } from "@/app/home-client-app-state";

export function canManageHomeClientActiveChat(input: {
  activeChat: AccessibleChat | null;
  activeProfile: Profile | null;
  isTemporaryChat: boolean;
}) {
  return (
    !input.isTemporaryChat &&
    Boolean(input.activeProfile) &&
    Boolean(input.activeChat) &&
    input.activeChat!.profileId === input.activeProfile!.id
  );
}

export function isHomeClientReasoningEnabled(input: {
  reasoningOptions: string[];
  selectedModel: Pick<ModelOption, "capabilities"> | null;
}) {
  return (
    Boolean(input.selectedModel?.capabilities?.reasoning) &&
    input.reasoningOptions.length > 0
  );
}

type UseHomeClientChatControllersInput = {
  appState: ReturnType<typeof useHomeClientAppState>;
  lanAdminAccessEnabled: boolean;
  profileSelection: ReturnType<typeof useHomeClientProfileSelection>;
  queueScrollTranscriptToBottom: (
    animation: "instant" | "smooth"
  ) => void;
  scrollTranscriptToBottom: (
    animation?: "instant" | "smooth"
  ) => void;
  t: I18nContextValue["t"];
};

export function useHomeClientChatControllers({
  appState,
  lanAdminAccessEnabled,
  profileSelection,
  queueScrollTranscriptToBottom,
  scrollTranscriptToBottom,
  t,
}: UseHomeClientChatControllersInput) {
  const isTemporaryChat = appState.temporaryMode.active;
  const temporarySessionId = appState.temporaryMode.sessionId;
  const temporaryModelId = appState.temporaryMode.modelId;
  const setTemporaryModelId = appState.temporaryMode.setModelId;

  const canManageActiveChat = canManageHomeClientActiveChat({
    activeChat: profileSelection.activeChat,
    activeProfile: profileSelection.activeProfile,
    isTemporaryChat,
  });

  const modelSelection = useHomeClientModelSelection({
    activeChat: profileSelection.activeChat,
    activeProfile: profileSelection.activeProfile,
    isTemporaryChat,
    setChats: appState.setChats,
    setTemporaryModelId,
    t,
    temporaryModelId,
  });

  const lanAdminState = useHomeClientLanAdmin({
    lanAdminAccessEnabled,
  });

  const reasoningEnabled = isHomeClientReasoningEnabled({
    reasoningOptions: modelSelection.reasoningOptions,
    selectedModel: modelSelection.selectedModel,
  });

  const chatSession = useHomeClientChatSession({
    activeChat: profileSelection.activeChat,
    activeProfile: profileSelection.activeProfile,
    effectiveModelId: modelSelection.effectiveModelId,
    instrumentedChatFetch: lanAdminState.instrumentedChatFetch,
    isTemporaryChat,
    lanAdminAccessEnabled,
    queueScrollTranscriptToBottom,
    readLanAdminToken: lanAdminState.readLanAdminToken,
    reasoningEffort: modelSelection.reasoningEffort,
    reasoningEnabled,
    scrollTranscriptToBottom,
    setVariantsByUserMessageId: appState.setVariantsByUserMessageId,
    t,
    temporarySessionId,
  });

  const chatBootstrap = useHomeClientChatBootstrap({
    activeProfileId: profileSelection.activeProfile?.id ?? "",
    loadedChatIdRef: appState.loadedChatIdRef,
    preferredNewChatModelId: modelSelection.preferredNewChatModelId,
    preloadedChatStateRef: appState.preloadedChatStateRef,
    setActiveChatId: appState.setActiveChatId,
    setChats: appState.setChats,
    setFolders: appState.setFolders,
    setIsTemporaryChat: appState.temporaryMode.setActive,
    setMessages: chatSession.setMessages,
    setVariantsByUserMessageId: appState.setVariantsByUserMessageId,
    status: chatSession.status,
    stop: chatSession.stop,
    syncRef: appState.syncRef,
  });

  const chatActions = useHomeClientChatActions({
    activeProfileId: profileSelection.activeProfile?.id ?? "",
    chats: appState.chats,
    refreshChats: chatBootstrap.refreshChats,
    setArchivedOpen: appState.setArchivedOpen,
    setChats: appState.setChats,
    statusReady: chatSession.status === "ready",
    t,
  });

  const editForkController = useHomeClientEditFork({
    activeChatId: appState.activeChatId,
    activeProfileId: profileSelection.activeProfile?.id ?? "",
    isTemporaryChat,
    messages: chatSession.messages,
    setActiveChatId: appState.setActiveChatId,
    setChats: appState.setChats,
    statusReady: chatSession.status === "ready",
    t,
    variantsByUserMessageId: appState.variantsByUserMessageId,
  });

  const chatStateSync = useHomeClientChatStateSync({
    activeChatId: appState.activeChatId,
    activeProfileId: profileSelection.activeProfileId,
    error: chatSession.error,
    isTemporaryChat,
    loadedChatIdRef: appState.loadedChatIdRef,
    messages: chatSession.messages,
    preloadedChatStateRef: appState.preloadedChatStateRef,
    queueScrollTranscriptToBottom,
    refreshChats: chatBootstrap.refreshChats,
    setMessages: chatSession.setMessages,
    setVariantsByUserMessageId: appState.setVariantsByUserMessageId,
    status: chatSession.status,
    stop: chatSession.stop,
    syncRef: appState.syncRef,
    variantsByUserMessageId: appState.variantsByUserMessageId,
  });

  const chatSettingsController = useHomeClientChatSettings({
    activeChat: profileSelection.activeChat,
    activeProfileId: profileSelection.activeProfile?.id ?? "",
    canManageActiveChat,
    chats: appState.chats,
    isTemporaryChat,
    refreshChats: chatBootstrap.refreshChats,
    setChats: appState.setChats,
    statusReady: chatSession.status === "ready",
    t,
  });

  return {
    canManageActiveChat,
    chatActions,
    chatBootstrap,
    chatSession,
    chatSettingsController,
    chatStateSync,
    editForkController,
    isTemporaryChat,
    lanAdminState,
    modelSelection,
    temporaryMode: appState.temporaryMode,
  };
}
