import type { UiLanguage } from "@/domain/profiles/types";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import {
  handleToolIntentShortcuts,
  routeIntentSafely,
} from "@/server/chat/intent-shortcuts";
import {
  maybeCreatePersistedMemoryPromptResponse,
} from "@/server/chat/memory-shortcuts";
import {
  listTurnAssistantTexts,
  recordActivatedSkillName,
} from "@/server/chats";
import { shouldForceMemoryAnswerTool } from "@/server/memory-answer-routing";
import { extractExplicitBashCommand } from "@/server/chat/helpers";
import { buildRegeneratePromptSection } from "@/server/chat/persisted-chat-context";
import {
  createExplicitOvNlSkillUnavailableHeaders,
  createExplicitOvNlSkillUnavailableResponse,
  describePersistedExplicitOvNlSkillUnavailableHint,
  hasUnavailableExplicitOvNlSkill,
  maybeCreateExplicitSkillActivationResponse,
  type ChatSkillsRuntime,
} from "@/server/chat/skills-runtime";
import { maybeCreateSkillsToolsSmokeTestResponse } from "@/server/chat/skills-smoke-test";

type CreateHeaders = (
  extra?: Record<string, string | undefined>,
) => HeadersInit;

type PersistedSkillsPreludeDependencies = {
  recordActivatedSkillNameImpl?: typeof recordActivatedSkillName;
  maybeCreateExplicitSkillActivationResponseImpl?: typeof maybeCreateExplicitSkillActivationResponse;
  maybeCreateSkillsToolsSmokeTestResponseImpl?: typeof maybeCreateSkillsToolsSmokeTestResponse;
};

type PersistedIntentPreflightDependencies = {
  routeIntentSafelyImpl?: typeof routeIntentSafely;
  maybeCreatePersistedMemoryPromptResponseImpl?: typeof maybeCreatePersistedMemoryPromptResponse;
  handleToolIntentShortcutsImpl?: typeof handleToolIntentShortcuts;
};

type PersistedExecutionDependencies = {
  listTurnAssistantTextsImpl?: typeof listTurnAssistantTexts;
};

export async function handlePersistedIntentPreflight(input: {
  canRouteIntent: boolean;
  directMemoryCandidate: string | null;
  lastUserText: string;
  viewerTimeZone?: string;
  profileId: string;
  chatId: string;
  profile: {
    id: string;
    memoryEnabled: boolean;
  };
  routerContext: {
    lastAssistantText?: string;
    lastToolName?: string;
  };
  resolveModel: Parameters<typeof handleToolIntentShortcuts>[0]["resolveModel"];
  messageMetadata: RemcoChatMessageMetadata;
  headers: HeadersInit;
  deps?: PersistedIntentPreflightDependencies;
}): Promise<{
  routedIntent: Awaited<ReturnType<typeof routeIntentSafely>> | null;
  response: Response | null;
}> {
  if (!input.canRouteIntent) {
    return { routedIntent: null, response: null };
  }

  const directMemoryResponse = (
    input.deps?.maybeCreatePersistedMemoryPromptResponseImpl ??
    maybeCreatePersistedMemoryPromptResponse
  )({
    candidate: input.directMemoryCandidate,
    chatId: input.chatId,
    profile: input.profile,
    messageMetadata: input.messageMetadata,
    headers: input.headers,
  });
  if (directMemoryResponse) {
    return {
      routedIntent: null,
      response: directMemoryResponse,
    };
  }

  const routed = await (
    input.deps?.routeIntentSafelyImpl ?? routeIntentSafely
  )({
    text: input.lastUserText,
    context: input.routerContext,
  });

  const routedMemoryResponse = (
    input.deps?.maybeCreatePersistedMemoryPromptResponseImpl ??
    maybeCreatePersistedMemoryPromptResponse
  )({
    candidate:
      routed && routed.intent === "memory_add" ? routed.memoryCandidate : null,
    chatId: input.chatId,
    profile: input.profile,
    messageMetadata: input.messageMetadata,
    headers: input.headers,
  });
  if (routedMemoryResponse) {
    return {
      routedIntent: routed,
      response: routedMemoryResponse,
    };
  }

  const shortcutResponse = await (
    input.deps?.handleToolIntentShortcutsImpl ?? handleToolIntentShortcuts
  )({
    routedIntent: routed,
    resolveModel: input.resolveModel,
    lastUserText: input.lastUserText,
    viewerTimeZone: input.viewerTimeZone,
    profileId: input.profileId,
    messageMetadata: input.messageMetadata,
    headers: input.headers,
    agendaErrorLogMessage: "Agenda intent extraction failed (fallback to main chat)",
  });

  return {
    routedIntent: routed,
    response: shortcutResponse,
  };
}

export function handlePersistedSkillResponses(input: {
  request: Request;
  runtime: ChatSkillsRuntime;
  chatId: string;
  lastUserText: string;
  toolsEnabled: boolean;
  uiLanguage: UiLanguage;
  messageMetadata?: RemcoChatMessageMetadata;
  createHeaders: CreateHeaders;
  deps?: PersistedSkillsPreludeDependencies;
}): Response | null {
  if (hasUnavailableExplicitOvNlSkill({ runtime: input.runtime })) {
    return createExplicitOvNlSkillUnavailableResponse({
      hint: describePersistedExplicitOvNlSkillUnavailableHint({
        request: input.request,
      }),
      messageMetadata: input.messageMetadata,
      headers: createExplicitOvNlSkillUnavailableHeaders(input.createHeaders),
    });
  }

  const explicitSkillName = input.runtime.skillInvocation.explicitSkillName;
  if (explicitSkillName) {
    try {
      (
        input.deps?.recordActivatedSkillNameImpl ?? recordActivatedSkillName
      )({
        chatId: input.chatId,
        skillName: explicitSkillName,
      });
    } catch {
      // Skill activation history is best-effort and must not break the turn.
    }
  }

  const activationResponse = (
    input.deps?.maybeCreateExplicitSkillActivationResponseImpl ??
    maybeCreateExplicitSkillActivationResponse
  )({
    runtime: input.runtime,
    language: input.uiLanguage,
    messageMetadata: input.messageMetadata,
    headers: input.createHeaders(),
  });
  if (activationResponse) return activationResponse;

  return (
    input.deps?.maybeCreateSkillsToolsSmokeTestResponseImpl ??
    maybeCreateSkillsToolsSmokeTestResponse
  )({
    chatId: input.chatId,
    explicitSkillName,
    lastUserText: input.lastUserText,
    toolsEnabled: input.toolsEnabled,
    skillsEnabled: Boolean(input.runtime.skillsRegistry),
    messageMetadata: input.messageMetadata,
    headers: input.createHeaders(),
  });
}

export function preparePersistedToolingDecisions(input: {
  chatId: string;
  turnUserMessageId: string;
  isRegenerate: boolean;
  lastUserText: string;
  memoryLines: string[];
  bashToolsEnabled: boolean;
  deps?: PersistedExecutionDependencies;
}) {
  const priorAssistantTexts =
    input.isRegenerate && input.turnUserMessageId
      ? (
          input.deps?.listTurnAssistantTextsImpl ?? listTurnAssistantTexts
        )({
          chatId: input.chatId,
          turnUserMessageId: input.turnUserMessageId,
          limit: 6,
        })
      : [];

  const regenerateSection = buildRegeneratePromptSection({
    isRegenerate: input.isRegenerate,
    priorAssistantTexts,
  });
  const forceMemoryAnswerTool = shouldForceMemoryAnswerTool(
    input.lastUserText,
    input.memoryLines,
  );
  const explicitBashCommand = input.bashToolsEnabled
    ? extractExplicitBashCommand(input.lastUserText)
    : null;

  return {
    regenerateSection,
    forceMemoryAnswerTool,
    explicitBashCommand,
    forcedToolName: forceMemoryAnswerTool ? "displayMemoryAnswer" : null,
    ovFastPathBlocked:
      forceMemoryAnswerTool || Boolean(explicitBashCommand),
  };
}
