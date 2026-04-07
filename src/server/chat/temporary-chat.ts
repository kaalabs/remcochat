import type { Profile } from "@/domain/profiles/types";
import { nanoid } from "nanoid";
import type { RemcoChatConfig } from "@/server/config";
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
  handleTemporaryIntentPreflight,
  handleTemporarySkillResponses,
  prepareTemporaryExecutionDecisions,
} from "@/server/chat/temporary-chat-orchestration";
import {
  prepareTemporaryPromptContext,
} from "@/server/chat/temporary-chat-context";
import {
  createChatResponseHeaders,
  createTurnMessageMetadata,
} from "@/server/chat/request-context";
import {
  executePreparedChatTurn,
} from "@/server/chat/turn-execution";
import type {
  ChatRequestBody,
} from "@/server/chat/types";

export type TemporaryChatRequestInput = {
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
  directMemoryCandidate: string | null;
  canRouteIntent: boolean;
  routerContext: {
    lastAssistantText?: string;
    lastToolName?: string;
  };
  explicitBashCommandFromUser: string | null;
  stopAfterTimezones: boolean;
  stopAfterCurrentDateTime: boolean;
};

export async function handleTemporaryChatRequest(
  input: TemporaryChatRequestInput,
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
    directMemoryCandidate,
    canRouteIntent,
    routerContext,
    explicitBashCommandFromUser,
    stopAfterTimezones,
    stopAfterCurrentDateTime,
  } = input;

  const temporaryMessageMetadata = () =>
    createTurnMessageMetadata({
      createdAt: now,
      turnUserMessageId,
    });
  const temporaryHeaders = (extra?: Record<string, string | undefined>) =>
    createChatResponseHeaders({
      apiVersion,
      temporary: true,
      profileId: profile.id,
      extra,
    });
  const candidateModelId =
    typeof body.modelId === "string" ? body.modelId : profile.defaultModelId;
  let resolved:
    | Awaited<ReturnType<typeof getLanguageModelForActiveProvider>>
    | undefined;
  const resolveModel = async (): Promise<
    Awaited<ReturnType<typeof getLanguageModelForActiveProvider>>
  > => {
    if (!resolved) {
      resolved = await getLanguageModelForActiveProvider(candidateModelId);
    }
    return resolved;
  };
  const {
    routedIntent,
    response: preflightResponse,
  } = await handleTemporaryIntentPreflight({
    canRouteIntent,
    directMemoryCandidate,
    lastUserText,
    viewerTimeZone,
    profileId: profile.id,
    routerContext,
    resolveModel,
    messageMetadata: temporaryMessageMetadata(),
    headers: temporaryHeaders(),
  });
  if (preflightResponse) return preflightResponse;

  try {
    resolved = await resolveModel();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load model." },
      { status: 500 },
    );
  }
  const resolvedModel = resolved;

  const {
    temporarySessionId,
    sessionKey,
    prompt,
  } = prepareTemporaryPromptContext({
    profileCustomInstructions: profile.customInstructions,
    profileInstructionsRevision: profile.customInstructionsRevision,
    temporarySessionId: body.temporarySessionId,
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
    sessionKey: sessionKey || null,
    messages: body.messages,
    lastUserText,
  });

  const {
    explicitBashCommand,
    ovFastPathBlocked,
    baseMessageMetadata,
  } = prepareTemporaryExecutionDecisions({
    createdAt: now,
    turnUserMessageId,
    profileInstructionsRevision: profile.customInstructionsRevision,
    explicitBashCommandFromUser,
    bashToolsEnabled: bashTools.enabled,
  });

  const {
    skillsRegistry,
    skillsTools,
    ovNlTools,
    availableSkills,
    skillInvocation,
    explicitSkillActivationOnly,
  } = skillsRuntime;
  const skillsResponse = handleTemporarySkillResponses({
    request,
    ovNlConfig: config.ovNl,
    runtime: skillsRuntime,
    uiLanguage: profile.uiLanguage,
    messageMetadata: temporaryMessageMetadata(),
    createHeaders: temporaryHeaders,
  });
  if (skillsResponse) return skillsResponse;

  const gatewayRuntime = createChatGatewayRuntime({
    request,
    isTemporary: true,
    routedIntent,
    explicitSkillName: skillInvocation.explicitSkillName,
    ovNlTools,
    temporarySessionId,
    turnUserMessageId: lastUserMessageId,
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
      explicitBashCommand,
      profileId: profile.id,
      messages: skillInvocation.messages,
    },
    attachmentError: {
      headers: temporaryHeaders(),
    },
    createToolingInput: ({ system }) => ({
      gatewayRuntime,
      ovFastPath: {
        enabled: ovNlTools.enabled,
        blocked: ovFastPathBlocked,
        explicitSkillActivationOnly,
        text: lastUserTextFromMessages(skillInvocation.messages),
        previousUserText,
        messages: skillInvocation.messages,
        messageMetadata: temporaryMessageMetadata(),
        headers: temporaryHeaders(),
      },
      toolLoop: {
        profileId: profile.id,
        isTemporary: true,
        memoryEnabled: false,
        viewerTimeZone,
        lastUserText,
        previousUserText,
        resolved: resolvedModel,
        routedIntent,
        routerContext,
        maxSteps,
        explicitBashCommand,
        explicitSkillActivationOnly,
        forceToolName: null,
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
      headers: temporaryHeaders(headerExtras),
      resolvedModel,
      providers: config.providers,
      baseMessageMetadata,
      sendReasoning: config.reasoning.exposeToClient,
      createMessageId: nanoid,
      lastUserText,
      providerOptions,
      webTools,
      explicitBashCommandFromUser,
    }),
  });
}
