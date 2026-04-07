import type { Profile } from "@/domain/profiles/types";
import {
  getChat,
  getChatForViewer,
  updateChat,
} from "@/server/chats";
import { nanoid } from "nanoid";
import { listProfileMemory } from "@/server/memory-service";
import {
  getPendingMemory,
} from "@/server/pending-memory";
import type { RemcoChatConfig } from "@/server/config";
import { isModelAllowedForActiveProvider } from "@/server/model-registry";
import { getLanguageModelForActiveProvider } from "@/server/llm-provider";
import {
  lastUserTextFromMessages,
} from "@/server/chat/helpers";
import {
  prepareChatExecutionRuntime,
} from "@/server/chat/chat-runtime";
import {
  createChatGatewayRuntime,
} from "@/server/chat/tool-runtime";
import {
  handleMemorizeDecision,
} from "@/server/chat/memory-shortcuts";
import {
  filterPersistedMessagesForCurrentInstructions,
  preparePersistedPromptContext,
} from "@/server/chat/persisted-chat-context";
import {
  handlePersistedIntentPreflight,
  handlePersistedSkillResponses,
  preparePersistedToolingDecisions,
} from "@/server/chat/persisted-chat-orchestration";
import {
  createChatResponseHeaders,
  createTurnMessageMetadata,
} from "@/server/chat/request-context";
import {
  executePreparedChatTurn,
} from "@/server/chat/turn-execution";
import type {
  ChatRequestBody,
  StreamTextToolSet,
} from "@/server/chat/types";

export type PersistedChatRequestInput = {
  request: Request;
  body: ChatRequestBody;
  profile: Profile;
  config: RemcoChatConfig;
  apiVersion: string;
  now: string;
  viewerTimeZone?: string;
  lastUserMessageId: string;
  lastUserText: string;
  previousUserText: string;
  turnUserMessageId?: string;
  memorizeDecision: "confirm" | "cancel" | null;
  directMemoryCandidate: string | null;
  canRouteIntent: boolean;
  routerContext: {
    lastAssistantText?: string;
    lastToolName?: string;
  };
  explicitBashCommandFromUser: string | null;
  stopAfterTimezones: boolean;
  stopAfterCurrentDateTime: boolean;
  isRegenerate: boolean;
};

export async function handlePersistedChatRequest(
  input: PersistedChatRequestInput,
): Promise<Response> {
  const {
    request,
    body,
    profile,
    config,
    apiVersion,
    now,
    viewerTimeZone,
    lastUserMessageId,
    lastUserText,
    previousUserText,
    turnUserMessageId,
    memorizeDecision,
    directMemoryCandidate,
    canRouteIntent,
    routerContext,
    explicitBashCommandFromUser,
    stopAfterTimezones,
    stopAfterCurrentDateTime,
    isRegenerate,
  } = input;

  if (!body.chatId) {
    return Response.json({ error: "Missing chatId." }, { status: 400 });
  }

  let chat: ReturnType<typeof getChatForViewer>;
  try {
    chat = getChatForViewer(profile.id, body.chatId);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Chat not accessible." },
      { status: 400 },
    );
  }

  if (
    typeof body.modelId === "string" &&
    isModelAllowedForActiveProvider(body.modelId) &&
    body.modelId !== chat.modelId &&
    chat.scope === "owned"
  ) {
    updateChat(chat.id, { modelId: body.modelId });
  }

  const effectiveChat = getChat(chat.id);
  const currentProfileRevision = profile.customInstructionsRevision;
  const currentChatRevision = effectiveChat.chatInstructionsRevision;
  const pendingMemory = getPendingMemory(effectiveChat.id);
  let resolved:
    | Awaited<ReturnType<typeof getLanguageModelForActiveProvider>>
    | undefined;
  const resolveModel = async (): Promise<
    Awaited<ReturnType<typeof getLanguageModelForActiveProvider>>
  > => {
    if (!resolved) {
      resolved = await getLanguageModelForActiveProvider(effectiveChat.modelId);
    }
    return resolved;
  };
  const persistedMessageMetadata = () =>
    createTurnMessageMetadata({
      createdAt: now,
      turnUserMessageId,
      profileInstructionsRevision: currentProfileRevision,
      chatInstructionsRevision: currentChatRevision,
    });
  const chatHeaders = (extra?: Record<string, string | undefined>) =>
    createChatResponseHeaders({
      apiVersion,
      temporary: false,
      profileId: profile.id,
      chatId: effectiveChat.id,
      extra,
    });

  const memorizeDecisionResponse = handleMemorizeDecision({
    pendingMemory,
    memorizeDecision,
    messages: body.messages,
    lastUserMessageId,
    chatId: effectiveChat.id,
    profile: {
      id: profile.id,
      memoryEnabled: profile.memoryEnabled,
    },
    messageMetadata: persistedMessageMetadata(),
    headers: chatHeaders(),
  });
  if (memorizeDecisionResponse) return memorizeDecisionResponse;

  const {
    routedIntent,
    response: preflightResponse,
  } = await handlePersistedIntentPreflight({
    canRouteIntent,
    directMemoryCandidate,
    lastUserText,
    viewerTimeZone,
    profileId: profile.id,
    chatId: effectiveChat.id,
    profile: {
      id: profile.id,
      memoryEnabled: profile.memoryEnabled,
    },
    routerContext,
    resolveModel,
    messageMetadata: persistedMessageMetadata(),
    headers: chatHeaders(),
  });
  if (preflightResponse) return preflightResponse;

  const {
    memoryLines,
    prompt,
  } = preparePersistedPromptContext({
    profileCustomInstructions: profile.customInstructions,
    profileInstructionsRevision: profile.customInstructionsRevision,
    chatInstructions: effectiveChat.chatInstructions,
    chatInstructionsRevision: effectiveChat.chatInstructionsRevision,
    memoryEnabled: profile.memoryEnabled,
    memory: listProfileMemory(profile.id),
    activatedSkillNames: effectiveChat.activatedSkillNames,
  });

  try {
    resolved = await resolveModel();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load model." },
      { status: 500 },
    );
  }
  const resolvedModel = resolved;

  const filteredMessages = filterPersistedMessagesForCurrentInstructions({
    messages: body.messages,
    regenerateMessageId:
      typeof body.regenerateMessageId === "string" ? body.regenerateMessageId : "",
    currentProfileRevision,
    currentChatRevision,
  });

  const {
    reasoningSelection,
    webTools,
    bashTools,
    localAccessTools,
    providerOptions,
    maxSteps,
    skillsRuntime,
  } = await prepareChatExecutionRuntime({
    request,
    resolved,
    configReasoning: config.reasoning,
    requestedEffort: body.reasoning?.effort,
    sessionKey: `chat:${effectiveChat.id}`,
    messages: filteredMessages,
    lastUserText,
    chatId: effectiveChat.id,
  });
  const {
    skillsRegistry,
    skillsTools,
    ovNlTools,
    availableSkills,
    skillInvocation,
    explicitSkillActivationOnly,
  } = skillsRuntime;
  const skillsResponse = handlePersistedSkillResponses({
    request,
    chatId: effectiveChat.id,
    runtime: skillsRuntime,
    uiLanguage: profile.uiLanguage,
    lastUserText,
    toolsEnabled: resolved.capabilities.tools,
    messageMetadata: persistedMessageMetadata(),
    createHeaders: chatHeaders,
  });
  if (skillsResponse) return skillsResponse;

  const gatewayRuntime = createChatGatewayRuntime({
    request,
    isTemporary: false,
    routedIntent,
    explicitSkillName: skillInvocation.explicitSkillName,
    activatedSkillNames: effectiveChat.activatedSkillNames,
    ovNlTools,
    chatId: effectiveChat.id,
    turnUserMessageId: lastUserMessageId,
  });
  const {
    regenerateSection,
    explicitBashCommand,
    ovFastPathBlocked,
    forcedToolName,
  } = preparePersistedToolingDecisions({
    chatId: effectiveChat.id,
    turnUserMessageId: lastUserMessageId,
    isRegenerate,
    lastUserText,
    memoryLines,
    bashToolsEnabled: bashTools.enabled,
  });

  return await executePreparedChatTurn({
    execution: {
      resolved,
      reasoning: {
        enabled: config.reasoning.enabled,
        exposeToClient: config.reasoning.exposeToClient,
        requestedEffort: reasoningSelection.requestedEffort,
        effectiveEffort: reasoningSelection.effectiveEffort,
      },
      prompt,
      skills: {
        skillsRegistry,
        availableSkills,
        explicitSkillName: skillInvocation.explicitSkillName,
        maxSkillMdBytes: config.skills?.maxSkillMdBytes ?? 200_000,
      },
      tools: {
        webTools,
        localAccessTools,
        bashTools,
        ovNlTools,
      },
      bashToolsConfig: {
        provider: config.bashTools?.provider,
        runtime: config.bashTools?.sandbox?.runtime,
      },
      attachmentsEnabled: config.attachments.enabled,
      ovNlPromptPolicy: {
        toolAllowed: gatewayRuntime.ovNlPolicy.toolAllowedForPrompt,
        toolConfidence: gatewayRuntime.ovNlPolicy.routerConfidence ?? undefined,
      },
      extraSections: regenerateSection ? [regenerateSection] : [],
      isRegenerate,
      profileId: profile.id,
      messages: skillInvocation.messages,
    },
    attachmentError: {
      headers: chatHeaders(),
      messageMetadata: persistedMessageMetadata(),
    },
    createToolingInput: ({
      system,
      modelMessages,
      temperature,
    }) => ({
      gatewayRuntime,
      ovFastPath: {
        enabled: ovNlTools.enabled,
        blocked: ovFastPathBlocked,
        explicitSkillActivationOnly,
        text: lastUserTextFromMessages(skillInvocation.messages),
        previousUserText,
        messages: skillInvocation.messages,
        messageMetadata: persistedMessageMetadata(),
        headers: chatHeaders(),
        recovery: {
          model: resolvedModel.model,
          system,
          messages: modelMessages,
          providerOptions,
          sendReasoning: config.reasoning.exposeToClient,
          temperature,
          ovTools: ovNlTools.tools as StreamTextToolSet,
        },
      },
      toolLoop: {
        profileId: profile.id,
        chatId: effectiveChat.id,
        isTemporary: false,
        memoryEnabled: profile.memoryEnabled,
        viewerTimeZone,
        lastUserText,
        previousUserText,
        resolved: resolvedModel,
        routedIntent,
        routerContext,
        maxSteps,
        explicitBashCommand,
        explicitSkillActivationOnly,
        forceToolName: forcedToolName,
        stopAfterCurrentDateTime,
        stopAfterTimezones,
        baseSystem: system,
        webTools,
        localAccessTools,
        bashTools,
        skillsTools,
        ovNlTools,
      },
    }),
    createStreamInput: ({ headerExtras }) => ({
      headers: chatHeaders(headerExtras),
      resolvedModel,
      providers: config.providers,
      baseMessageMetadata: persistedMessageMetadata(),
      sendReasoning: config.reasoning.exposeToClient,
      createMessageId: nanoid,
      lastUserText,
      providerOptions,
      webTools,
      explicitBashCommandFromUser,
    }),
  });
}
