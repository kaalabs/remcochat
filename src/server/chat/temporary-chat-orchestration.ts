import type { UiLanguage } from "@/domain/profiles/types";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { RemcoChatConfig } from "@/server/config";
import {
  handleToolIntentShortcuts,
  routeIntentSafely,
} from "@/server/chat/intent-shortcuts";
import {
  uiTextResponse,
} from "@/server/chat/presenters";
import {
  createTurnMessageMetadata,
} from "@/server/chat/request-context";
import {
  createExplicitOvNlSkillUnavailableHeaders,
  createExplicitOvNlSkillUnavailableResponse,
  describeTemporaryExplicitOvNlSkillUnavailableHint,
  hasUnavailableExplicitOvNlSkill,
  maybeCreateExplicitSkillActivationResponse,
  type ChatSkillsRuntime,
} from "@/server/chat/skills-runtime";

type CreateHeaders = (
  extra?: Record<string, string | undefined>,
) => HeadersInit;

type TemporaryIntentPreflightDependencies = {
  routeIntentSafelyImpl?: typeof routeIntentSafely;
  handleToolIntentShortcutsImpl?: typeof handleToolIntentShortcuts;
};

export const TEMPORARY_MEMORY_BLOCKED_TEXT =
  "Temporary chats do not save memory. Turn off Temp, then ask me to remember something and confirm when asked.";

export const TEMPORARY_AGENDA_MUTATION_BLOCKED_TEXT =
  "Temporary chats do not save agenda items. Turn off Temp to manage your agenda.";

export async function handleTemporaryIntentPreflight(input: {
  canRouteIntent: boolean;
  directMemoryCandidate: string | null;
  lastUserText: string;
  viewerTimeZone?: string;
  profileId: string;
  routerContext: {
    lastAssistantText?: string;
    lastToolName?: string;
  };
  resolveModel: Parameters<typeof handleToolIntentShortcuts>[0]["resolveModel"];
  messageMetadata: RemcoChatMessageMetadata;
  headers: HeadersInit;
  deps?: TemporaryIntentPreflightDependencies;
}): Promise<{
  routedIntent: Awaited<ReturnType<typeof routeIntentSafely>> | null;
  response: Response | null;
}> {
  if (!input.canRouteIntent) {
    return { routedIntent: null, response: null };
  }

  if (input.directMemoryCandidate) {
    return {
      routedIntent: null,
      response: uiTextResponse({
        text: TEMPORARY_MEMORY_BLOCKED_TEXT,
        messageMetadata: input.messageMetadata,
      }),
    };
  }

  const routed = await (
    input.deps?.routeIntentSafelyImpl ?? routeIntentSafely
  )({
    text: input.lastUserText,
    context: input.routerContext,
  });

  if (routed && routed.intent === "memory_add") {
    return {
      routedIntent: routed,
      response: uiTextResponse({
        text: TEMPORARY_MEMORY_BLOCKED_TEXT,
        messageMetadata: input.messageMetadata,
      }),
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
    agendaErrorLogMessage: "Agenda intent extraction failed (temporary chat fallback)",
    agendaMutationBlockedText: TEMPORARY_AGENDA_MUTATION_BLOCKED_TEXT,
  });

  return {
    routedIntent: routed,
    response: shortcutResponse,
  };
}

export function handleTemporarySkillResponses(input: {
  request: Request;
  ovNlConfig: RemcoChatConfig["ovNl"];
  runtime: ChatSkillsRuntime;
  uiLanguage: UiLanguage;
  messageMetadata?: RemcoChatMessageMetadata;
  createHeaders: CreateHeaders;
}): Response | null {
  if (hasUnavailableExplicitOvNlSkill({ runtime: input.runtime })) {
    return createExplicitOvNlSkillUnavailableResponse({
      hint: describeTemporaryExplicitOvNlSkillUnavailableHint({
        request: input.request,
        ovNlConfig: input.ovNlConfig,
      }),
      messageMetadata: input.messageMetadata,
      headers: createExplicitOvNlSkillUnavailableHeaders(input.createHeaders),
    });
  }

  return maybeCreateExplicitSkillActivationResponse({
    runtime: input.runtime,
    language: input.uiLanguage,
    messageMetadata: input.messageMetadata,
    headers: input.createHeaders(),
  });
}

export function prepareTemporaryExecutionDecisions(input: {
  createdAt: string;
  turnUserMessageId?: string;
  profileInstructionsRevision: number;
  explicitBashCommandFromUser: string | null;
  bashToolsEnabled: boolean;
}) {
  const explicitBashCommand = input.bashToolsEnabled
    ? input.explicitBashCommandFromUser
    : null;

  return {
    explicitBashCommand,
    ovFastPathBlocked: Boolean(explicitBashCommand),
    baseMessageMetadata: createTurnMessageMetadata({
      createdAt: input.createdAt,
      turnUserMessageId: input.turnUserMessageId,
      profileInstructionsRevision: input.profileInstructionsRevision,
      chatInstructionsRevision: 0,
    }),
  };
}
