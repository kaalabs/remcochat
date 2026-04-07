import type { UiLanguage } from "@/domain/profiles/types";
import { createOvNlTools, type OvNlGatewayToolsResult } from "@/ai/ov-nl-tools";
import { createSkillsTools, type SkillsToolsResult } from "@/ai/skills-tools";
import type { RemcoChatConfig } from "@/server/config";
import { stripWebToolPartsFromMessages } from "@/server/message-sanitize";
import {
  adminTokenFromRequest,
  isLocalhostRequest,
  isRequestAllowedByAdminPolicy,
} from "@/server/request-auth";
import { explicitSkillNameCandidate } from "@/server/chat/helpers";
import {
  isExplicitOvNlSkillUnavailable,
  prepareChatSkillsContext,
} from "@/server/chat/skills-context";
import { uiSkillsActivateResponse, uiTextResponse } from "@/server/chat/presenters";
import { OV_NL_SKILL_NAME } from "@/server/ov/ov-nl-constants";
import { getSkillsRegistry } from "@/server/skills/runtime";
import type { ChatMessage } from "@/server/chat/types";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";

type ChatSkillsContextResult = ReturnType<typeof prepareChatSkillsContext>;

export type ChatSkillsRuntime = ChatSkillsContextResult & {
  skillsRegistry: ReturnType<typeof getSkillsRegistry>;
  skillsTools: SkillsToolsResult;
  ovNlTools: OvNlGatewayToolsResult;
  explicitSkillCandidate: string | null;
};

export function createChatSkillsRuntime(input: {
  request: Request;
  messages: ChatMessage[];
  lastUserText: string;
  chatId?: string;
}): ChatSkillsRuntime {
  const skillsRegistry = getSkillsRegistry();
  const skillsTools = createSkillsTools({
    enabled: Boolean(skillsRegistry),
    ...(input.chatId ? { chatId: input.chatId } : {}),
  });
  const ovNlTools = createOvNlTools({
    request: input.request,
  });
  const explicitSkillCandidate = explicitSkillNameCandidate(input.lastUserText);
  const prepared = prepareChatSkillsContext({
    messages: stripWebToolPartsFromMessages(input.messages),
    skillsRegistry,
    ovNlToolsEnabled: ovNlTools.enabled,
  });

  return {
    skillsRegistry,
    skillsTools,
    ovNlTools,
    explicitSkillCandidate,
    ...prepared,
  };
}

export function hasUnavailableExplicitOvNlSkill(input: {
  runtime: ChatSkillsRuntime;
}): boolean {
  return isExplicitOvNlSkillUnavailable({
    explicitSkillCandidate: input.runtime.explicitSkillCandidate,
    skillsRegistry: input.runtime.skillsRegistry,
    ovNlToolsEnabled: input.runtime.ovNlTools.enabled,
  });
}

export function createExplicitOvNlSkillUnavailableResponse(input: {
  hint: string;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  return uiTextResponse({
    text:
      `De skill "/${OV_NL_SKILL_NAME}" is wel geinstalleerd, maar is nu niet beschikbaar omdat de OV NL tool (ovNlGateway) niet is ingeschakeld voor jouw request.\n\n` +
      input.hint,
    messageMetadata: input.messageMetadata,
    headers: input.headers,
  });
}

function createExplicitOvNlAdminPolicyHint(request: Request) {
  const required = String(process.env.REMCOCHAT_ADMIN_TOKEN ?? "").trim();
  const provided = String(adminTokenFromRequest(request) ?? "").trim();
  return !required
    ? "Server-side REMCOCHAT_ADMIN_TOKEN ontbreekt. Zet REMCOCHAT_ADMIN_TOKEN in je productie .env en herstart de stack."
    : !provided
      ? "Je request bevat geen admin-token. Klik op het sleutel-icoon (Admin access), plak REMCOCHAT_ADMIN_TOKEN, en klik op 'Save locally'."
      : "Je request bevat wel een admin-token, maar die wordt niet geaccepteerd (token mismatch). Klik op het sleutel-icoon (Admin access), 'Clear', plak opnieuw de server token, en klik op 'Save locally'.";
}

export function createExplicitOvNlSkillUnavailableHeaders(
  createHeaders: (extra?: Record<string, string | undefined>) => HeadersInit,
) {
  return createHeaders({
    "x-remcochat-ov-nl-tools-enabled": "0",
    "x-remcochat-ov-nl-tools": "",
  });
}

export function describeTemporaryExplicitOvNlSkillUnavailableHint(input: {
  request: Request;
  ovNlConfig: RemcoChatConfig["ovNl"];
}) {
  const cfg = input.ovNlConfig;
  if (!cfg || !cfg.enabled) {
    return 'De OV NL tool staat niet aan in je server config. Voeg een [app.ov_nl] sectie toe met enabled=true (en access="lan" voor LAN-gebruik) in je actieve config.toml, en herstart de server.';
  }
  if (cfg.access === "localhost" && !isLocalhostRequest(input.request)) {
    return 'De OV NL tool staat op access="localhost" en is niet beschikbaar via LAN. Zet app.ov_nl.access="lan" en herstart de server.';
  }
  if (cfg.access === "lan" && !isRequestAllowedByAdminPolicy(input.request)) {
    return createExplicitOvNlAdminPolicyHint(input.request);
  }
  return "De OV NL tool is niet ingeschakeld voor dit request (onbekende reden). Controleer je actieve config.toml en herstart de server.";
}

export function describePersistedExplicitOvNlSkillUnavailableHint(input: {
  request: Request;
}) {
  return createExplicitOvNlAdminPolicyHint(input.request);
}

export function maybeCreateExplicitSkillActivationResponse(input: {
  runtime: ChatSkillsRuntime;
  language: UiLanguage;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  if (
    !input.runtime.explicitSkillActivationOnly ||
    !input.runtime.skillInvocation.explicitSkillName
  ) {
    return null;
  }

  const activateTool = (input.runtime.skillsTools.tools as {
    skillsActivate?: {
      execute?: (args: { name: string }) => Promise<unknown>;
    };
  }).skillsActivate;

  if (typeof activateTool?.execute !== "function") {
    return null;
  }

  return uiSkillsActivateResponse({
    skillName: input.runtime.skillInvocation.explicitSkillName,
    language: input.language,
    executeActivate: activateTool.execute,
    messageMetadata: input.messageMetadata,
    headers: input.headers,
  });
}
