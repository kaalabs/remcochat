import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import { routeAgendaCommand } from "@/server/agenda-intent";
import { routeIntent, type IntentRoute } from "@/server/intent-router";
import { getLanguageModelForActiveProvider } from "@/server/llm-provider";
import { isAgendaMutation } from "@/server/chat/helpers";
import {
  uiAgendaResponse,
  uiTextResponse,
  uiWeatherForecastResponse,
  uiWeatherResponse,
} from "@/server/chat/presenters";
import { needsViewerTimeZoneForAgenda } from "@/server/chat/request-context";

export async function routeIntentSafely(
  input: Parameters<typeof routeIntent>[0],
): Promise<Awaited<ReturnType<typeof routeIntent>>> {
  try {
    return await routeIntent(input);
  } catch (err) {
    console.error("Intent router failed", err);
    return { intent: "none", confidence: 0 };
  }
}

export async function handleToolIntentShortcuts(input: {
  routedIntent: IntentRoute | null;
  resolveModel: () => Promise<
    Awaited<ReturnType<typeof getLanguageModelForActiveProvider>>
  >;
  lastUserText: string;
  viewerTimeZone?: string;
  profileId: string;
  messageMetadata: RemcoChatMessageMetadata;
  headers: HeadersInit;
  agendaErrorLogMessage: string;
  agendaMutationBlockedText?: string;
}) {
  if (input.routedIntent?.intent === "weather_current") {
    try {
      const resolvedForTools = await input.resolveModel();
      if (resolvedForTools.capabilities.tools) {
        return uiWeatherResponse({
          location: input.routedIntent.location,
          messageMetadata: input.messageMetadata,
          headers: input.headers,
        });
      }
    } catch (err) {
      return Response.json(
        {
          error:
            err instanceof Error ? err.message : "Failed to load model.",
        },
        { status: 500 },
      );
    }
  }

  if (input.routedIntent?.intent === "weather_forecast") {
    try {
      const resolvedForTools = await input.resolveModel();
      if (resolvedForTools.capabilities.tools) {
        return uiWeatherForecastResponse({
          location: input.routedIntent.location,
          messageMetadata: input.messageMetadata,
          headers: input.headers,
        });
      }
    } catch (err) {
      return Response.json(
        {
          error:
            err instanceof Error ? err.message : "Failed to load model.",
        },
        { status: 500 },
      );
    }
  }

  if (input.routedIntent?.intent !== "agenda") return null;

  let agendaResult: Awaited<ReturnType<typeof routeAgendaCommand>> = {
    ok: false,
    error: "Agenda routing failed.",
  };
  try {
    agendaResult = await routeAgendaCommand({ text: input.lastUserText });
  } catch (err) {
    console.error(input.agendaErrorLogMessage, err);
  }
  if (!agendaResult.ok) return null;

  if (needsViewerTimeZoneForAgenda(agendaResult.command, input.viewerTimeZone)) {
    return uiTextResponse({
      text:
        "I couldn't determine your timezone. Tell me your timezone (example: Europe/Amsterdam) or include it in your request, then try again.",
      messageMetadata: input.messageMetadata,
    });
  }

  if (input.agendaMutationBlockedText && isAgendaMutation(agendaResult.command.action)) {
    return uiTextResponse({
      text: input.agendaMutationBlockedText,
      messageMetadata: input.messageMetadata,
    });
  }

  return uiAgendaResponse({
    profileId: input.profileId,
    command: agendaResult.command,
    viewerTimeZone: input.viewerTimeZone,
    messageMetadata: input.messageMetadata,
    headers: input.headers,
  });
}
