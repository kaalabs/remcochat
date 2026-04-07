import type { UiLanguage } from "@/domain/profiles/types";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { AgendaToolOutput } from "@/domain/agenda/types";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { nanoid } from "nanoid";
import {
  getWeatherForLocation,
  getWeatherForecastForLocation,
} from "@/ai/weather";
import { WEATHER_HOURLY_FORECAST_HOURS } from "@/lib/weather-constants";
import { runAgendaAction, type AgendaActionInput } from "@/server/agenda";
import { stripUIMessageStream } from "@/server/ui-stream";

export function uiTextResponse(input: {
  text: string;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  const messageId = nanoid();
  const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({ type: "text-start", id: messageId });
      writer.write({ type: "text-delta", id: messageId, delta: input.text });
      writer.write({ type: "text-end", id: messageId });
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return createUIMessageStreamResponse({ stream, headers: input.headers });
}

export function uiTextContinuationStream(input: {
  text: string;
  messageMetadata?: RemcoChatMessageMetadata;
}) {
  const messageId = nanoid();
  const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({ type: "text-start", id: messageId });
      writer.write({ type: "text-delta", id: messageId, delta: input.text });
      writer.write({ type: "text-end", id: messageId });
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return stripUIMessageStream(stream, { dropStart: true });
}

export function uiMemoryPromptResponse(input: {
  content: string;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  const messageId = nanoid();
  const toolCallId = nanoid();
  const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "displayMemoryPrompt",
        input: { content: input.content },
      });
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: { content: input.content },
      });
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return createUIMessageStreamResponse({ stream, headers: input.headers });
}

export function uiMemoryAnswerResponse(input: {
  answer: string;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  const messageId = nanoid();
  const toolCallId = nanoid();
  const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "displayMemoryAnswer",
        input: { answer: input.answer },
      });
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: { answer: input.answer },
      });
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return createUIMessageStreamResponse({ stream, headers: input.headers });
}

export function uiSkillsActivateResponse(input: {
  skillName: string;
  language: UiLanguage;
  executeActivate: (args: { name: string }) => Promise<unknown>;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  const followUpBySkillName: Record<UiLanguage, Record<string, string>> = {
    en: {
      "ov-nl-travel": "Ask your travel question to continue.",
      "hue-instant-control": "Ask your lighting question to continue.",
    },
    nl: {
      "ov-nl-travel": "Stel je reisvraag om door te gaan.",
      "hue-instant-control": "Stel je verlichtingsvraag om door te gaan.",
    },
  };
  const genericFollowUpByLanguage: Record<UiLanguage, string> = {
    en: "Ask your question to continue.",
    nl: "Stel je vraag om door te gaan.",
  };
  const activatedPrefixByLanguage: Record<UiLanguage, string> = {
    en: `Skill "/${input.skillName}" activated.`,
    nl: `Skill "/${input.skillName}" geactiveerd.`,
  };
  const activationErrorPrefixByLanguage: Record<UiLanguage, string> = {
    en: "Skill activation error",
    nl: "Skill-activatiefout",
  };
  const fallbackActivationErrorByLanguage: Record<UiLanguage, string> = {
    en: "Failed to activate skill.",
    nl: "Skill activeren is mislukt.",
  };
  const followUp =
    followUpBySkillName[input.language][input.skillName] ??
    genericFollowUpByLanguage[input.language];
  const messageId = nanoid();
  const toolCallId = nanoid();
  const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "skillsActivate",
        input: { name: input.skillName },
      });

      try {
        const output = await input.executeActivate({ name: input.skillName });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
        writer.write({ type: "text-start", id: messageId });
        writer.write({
          type: "text-delta",
          id: messageId,
          delta: `${activatedPrefixByLanguage[input.language]} ${followUp}`,
        });
        writer.write({ type: "text-end", id: messageId });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : fallbackActivationErrorByLanguage[input.language];
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText: message,
        });
        writer.write({ type: "text-start", id: messageId });
        writer.write({
          type: "text-delta",
          id: messageId,
          delta: `${activationErrorPrefixByLanguage[input.language]}: ${message}`,
        });
        writer.write({ type: "text-end", id: messageId });
      }

      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return createUIMessageStreamResponse({ stream, headers: input.headers });
}

export function uiWeatherResponse(input: {
  location: string;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  const messageId = nanoid();
  const toolCallId = nanoid();
  const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "displayWeather",
        input: { location: input.location },
      });
      try {
        const output = await getWeatherForLocation({
          location: input.location,
          forecastHours: WEATHER_HOURLY_FORECAST_HOURS,
        });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch weather.";
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText: message,
        });
        writer.write({ type: "text-start", id: messageId });
        writer.write({
          type: "text-delta",
          id: messageId,
          delta: `Weather error: ${message}`,
        });
        writer.write({ type: "text-end", id: messageId });
      }
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return createUIMessageStreamResponse({ stream, headers: input.headers });
}

export function uiWeatherForecastResponse(input: {
  location: string;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  const messageId = nanoid();
  const toolCallId = nanoid();
  const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "displayWeatherForecast",
        input: { location: input.location },
      });
      try {
        const output = await getWeatherForecastForLocation({
          location: input.location,
          forecastDays: 7,
        });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch forecast.";
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText: message,
        });
        writer.write({ type: "text-start", id: messageId });
        writer.write({
          type: "text-delta",
          id: messageId,
          delta: `Forecast error: ${message}`,
        });
        writer.write({ type: "text-end", id: messageId });
      }
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return createUIMessageStreamResponse({ stream, headers: input.headers });
}

function toDisplayAgendaToolInput(command: AgendaActionInput) {
  switch (command.action) {
    case "create":
      return {
        action: "create",
        description: command.description,
        date: command.date,
        time: command.time,
        duration_minutes: command.durationMinutes,
        timezone: command.timezone ?? "",
      };
    case "update":
      return {
        action: "update",
        item_id: command.itemId ?? "",
        match: command.match,
        patch: {
          description: command.patch.description,
          date: command.patch.date,
          time: command.patch.time,
          duration_minutes: command.patch.durationMinutes,
          timezone: command.patch.timezone,
        },
      };
    case "delete":
      return {
        action: "delete",
        item_id: command.itemId ?? "",
        match: command.match,
      };
    case "share":
    case "unshare":
      return {
        action: command.action,
        item_id: command.itemId ?? "",
        match: command.match,
        target_profile: command.targetProfile,
      };
    case "list":
      return {
        action: "list",
        range: {
          kind: command.range.kind,
          days: command.range.kind === "next_n_days" ? command.range.days : undefined,
          timezone: command.range.timezone,
          week_start:
            command.range.kind === "this_week" ? command.range.weekStart : undefined,
        },
        include_overlaps: command.includeOverlaps ?? true,
      };
    default:
      return { action: "list", range: { kind: "today" } };
  }
}

export function uiAgendaResponse(input: {
  profileId: string;
  command: AgendaActionInput;
  viewerTimeZone?: string;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  const messageId = nanoid();
  const toolCallId = nanoid();
  const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
    generateId: nanoid,
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "displayAgenda",
        input: toDisplayAgendaToolInput(input.command),
      });
      try {
        const output: AgendaToolOutput = runAgendaAction(
          input.profileId,
          input.command,
          { viewerTimeZone: input.viewerTimeZone }
        );
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update agenda.";
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText: message,
        });
        writer.write({ type: "text-start", id: messageId });
        writer.write({
          type: "text-delta",
          id: messageId,
          delta: `Agenda error: ${message}\n\nPlease include a description (what the event is) and, for creates/updates, a date/time.`,
        });
        writer.write({ type: "text-end", id: messageId });
      }
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return createUIMessageStreamResponse({ stream, headers: input.headers });
}
