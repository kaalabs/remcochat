import { getProfile } from "@/server/profiles";
import { parseMemoryAddCommand, parseMemorizeDecision } from "@/server/memory-commands";
import { getConfig } from "@/server/config";
import {
  isCurrentDateTimeUserQuery,
  isTimezonesUserQuery,
} from "@/server/timezones-intent";
import {
  extractExplicitBashCommand,
  lastAssistantContext,
} from "@/server/chat/helpers";
import {
  getLastUserTurnContext,
  resolveViewerTimeZone,
} from "@/server/chat/request-context";
import { handlePersistedChatRequest } from "@/server/chat/persisted-chat";
import { handleTemporaryChatRequest } from "@/server/chat/temporary-chat";
import type { ChatRequestBody } from "@/server/chat/types";

export const maxDuration = 30;

const REMCOCHAT_API_VERSION = "instruction-frame-v1";

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequestBody;
  const isRegenerate = Boolean(body.regenerate);
  const config = getConfig();
  const viewerTimeZone = resolveViewerTimeZone(req);

  if (!body.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  const profile = getProfile(body.profileId);
  const isTemporary = Boolean(body.temporary);

  const now = new Date().toISOString();
  const { lastUserMessageId, lastUserText, previousUserText } = getLastUserTurnContext(
    body.messages,
  );
  const turnUserMessageId = lastUserMessageId || undefined;
  const stopAfterTimezones = isTimezonesUserQuery(lastUserText);
  const stopAfterCurrentDateTime = isCurrentDateTimeUserQuery(lastUserText);
  const explicitBashCommandFromUser = extractExplicitBashCommand(lastUserText);

  const memorizeDecision = parseMemorizeDecision(lastUserText);
  const directMemoryCandidate = parseMemoryAddCommand(lastUserText);
  const canRouteIntent = !isRegenerate && memorizeDecision == null;
  const routerContext = lastAssistantContext(body.messages);

  if (isTemporary) {
    return handleTemporaryChatRequest({
      request: req,
      body,
      profile,
      config,
      apiVersion: REMCOCHAT_API_VERSION,
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
    });
  }

  return handlePersistedChatRequest({
    request: req,
    body,
    profile,
    config,
    apiVersion: REMCOCHAT_API_VERSION,
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
  });
}
