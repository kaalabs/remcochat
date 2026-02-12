import type {
  AgendaToolOutput,
  OvNlToolOutput,
  RemcoChatMessageMetadata,
  UiLanguage,
} from "@/lib/types";
import {
  getChat,
  getChatForViewer,
  listTurnAssistantTexts,
  recordActivatedSkillName,
  updateChat,
} from "@/server/chats";
import { getProfile } from "@/server/profiles";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  hasToolCall,
  stepCountIs,
  streamText,
  type TextStreamPart,
  type UIMessage,
} from "ai";
import { nanoid } from "nanoid";
import { listProfileMemory } from "@/server/memory";
import { createMemoryItem } from "@/server/memory";
import {
  clearPendingMemory,
  getPendingMemory,
  upsertPendingMemory,
} from "@/server/pending-memory";
import crypto from "node:crypto";
import fs from "node:fs";
import { createTools } from "@/ai/tools";
import { createWebTools } from "@/ai/web-tools";
import { createBashTools, runExplicitBashCommand } from "@/ai/bash-tools";
import { createSkillsTools } from "@/ai/skills-tools";
import { createHueGatewayTools } from "@/ai/hue-gateway-tools";
import { createOvNlTools } from "@/ai/ov-nl-tools";
import { buildSystemPrompt } from "@/ai/system-prompt";
import { createProviderOptionsForWebTools } from "@/ai/provider-options";
import { formatPerplexitySearchResultsForPrompt } from "@/ai/perplexity";
import {
  allowedReasoningEfforts,
  normalizeReasoningEffort,
  type ReasoningEffort,
} from "@/lib/reasoning-effort";
import {
  isOvNlErrorLikeOutput,
} from "@/lib/ov-nl-recovery";
import {
  getWeatherForLocation,
  getWeatherForecastForLocation,
} from "@/ai/weather";
import { WEATHER_HOURLY_FORECAST_HOURS } from "@/lib/weather-constants";
import { stripWebToolPartsFromMessages } from "@/server/message-sanitize";
import { replaceAttachmentPartsWithExtractedText } from "@/server/attachment-prompt";
import { OV_NL_ROUTER_MIN_CONFIDENCE, routeIntent, type IntentRoute } from "@/server/intent-router";
import { routeAgendaCommand } from "@/server/agenda-intent";
import { parseMemoryAddCommand, parseMemorizeDecision } from "@/server/memory-commands";
import { getConfig } from "@/server/config";
import { logEvent } from "@/server/log";
import { isModelAllowedForActiveProvider } from "@/server/model-registry";
import { getLanguageModelForActiveProvider } from "@/server/llm-provider";
import { runAgendaAction, type AgendaActionInput } from "@/server/agenda";
import {
  adminTokenFromRequest,
  isLocalhostRequest,
  isRequestAllowedByAdminPolicy,
} from "@/server/request-auth";
import {
  isCurrentDateTimeUserQuery,
  isTimezonesUserQuery,
} from "@/server/timezones-intent";
import { getSkillsRegistry } from "@/server/skills/runtime";
import {
  isExplicitSkillActivationOnlyPrompt,
  stripExplicitSkillInvocationFromMessages,
} from "@/server/skills/explicit-invocation";
import { shouldForceMemoryAnswerTool } from "@/server/memory-answer-routing";
import { runOvFromUserText } from "@/server/ov/runner";
import { computeOvNlRoutingPolicy } from "@/server/ov/ov-nl-routing-policy";
import {
  collectUIMessageChunks,
  createUIMessageStreamWithDeferredContinuation,
  createUIMessageStreamWithToolErrorContinuation,
  stripUIMessageStream,
  type ToolStreamError,
} from "@/server/ui-stream";

export const maxDuration = 30;

const REMCOCHAT_API_VERSION = "instruction-frame-v1";
type StreamTextToolSet = NonNullable<Parameters<typeof streamText>[0]["tools"]>;

type ChatRequestBody = {
  messages: UIMessage<RemcoChatMessageMetadata>[];
  modelId?: string;
  profileId?: string;
  chatId?: string;
  temporary?: boolean;
  temporarySessionId?: string;
  regenerate?: boolean;
  regenerateMessageId?: string;
  reasoning?: {
    effort?: string;
  };
};

function messageText(message: UIMessage<RemcoChatMessageMetadata>) {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

function lastUserTextFromMessages(messages: UIMessage<RemcoChatMessageMetadata>[]): string {
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIndex < 0) return "";
  const msg = messages[lastUserIndex];
  return msg ? messageText(msg) : "";
}

function ovConstraintNoMatchQuestion(output: unknown): string {
  if (!isOvNlErrorLikeOutput(output) || output.kind !== "error") return "";
  if (output.error?.code !== "constraint_no_match") return "";
  const details =
    output.error?.details && typeof output.error.details === "object"
      ? (output.error.details as Record<string, unknown>)
      : null;
  const suggested = Array.isArray(details?.suggestedRelaxations)
    ? details?.suggestedRelaxations
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
    : [];
  if (suggested.length > 0) {
    return `No exact match with your strict constraints. Should I relax this: ${suggested[0]}?`;
  }
  return "No exact match with your strict constraints. Which one constraint should I relax?";
}

function previousUserMessageText(
  messages: UIMessage<RemcoChatMessageMetadata>[],
  currentUserMessageId: string
) {
  if (!currentUserMessageId) return "";
  const index = messages.findIndex((m) => m.id === currentUserMessageId);
  if (index <= 0) return "";
  for (let i = index - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    return messageText(msg);
  }
  return "";
}

function extractExplicitBashCommand(text: string): string | null {
  const value = String(text ?? "").trim();
  if (!value) return null;
  if (!/\brun\b/i.test(value)) return null;

  const inlineCandidates = Array.from(
    value.matchAll(/`([^`\n]{1,4000})`/g),
    (m) => String(m[1] ?? "").trim()
  ).filter(Boolean);
  if (inlineCandidates.length > 0) {
    const withWhitespace = inlineCandidates.filter((c) => /\s/.test(c));
    return (withWhitespace.length > 0
      ? withWhitespace[withWhitespace.length - 1]
      : inlineCandidates[inlineCandidates.length - 1])!;
  }

  const fenced = value.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]{1,8000}?)```/);
  if (fenced?.[1]) return fenced[1].trim();

  return null;
}

function explicitSkillNameCandidate(text: string): string | null {
  const raw = String(text ?? "");
  if (!raw.startsWith("/")) return null;
  const match = raw.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+|$)/);
  return match?.[1] ?? null;
}

function lastAssistantContext(messages: UIMessage<RemcoChatMessageMetadata>[]) {
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIndex <= 0) return {};

  for (let i = lastUserIndex - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;

    const lastAssistantText = messageText(msg);
    let lastToolName: string | undefined;
    for (const part of msg.parts) {
      const type = (part as { type?: unknown }).type;
      if (typeof type === "string" && type.startsWith("tool-")) {
        lastToolName = type.slice("tool-".length);
        break;
      }
    }

    return {
      lastAssistantText: lastAssistantText || undefined,
      lastToolName,
    };
  }

  return {};
}

function lastOvOutputFromMessages(messages: UIMessage<RemcoChatMessageMetadata>[]): OvNlToolOutput | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    for (let j = msg.parts.length - 1; j >= 0; j -= 1) {
      const part = msg.parts[j] as {
        type?: unknown;
        state?: unknown;
        output?: unknown;
      };
      if (part.type !== "tool-ovNlGateway") continue;
      if (part.state !== "output-available") continue;
      if (!part.output || typeof part.output !== "object") continue;
      return part.output as OvNlToolOutput;
    }
  }
  return null;
}

function readFileForPrompt(filePath: string, maxBytes: number): string {
  const max = Math.max(1_000, Math.floor(Number(maxBytes ?? 200_000)));
  const buf = fs.readFileSync(filePath);
  if (buf.length <= max) return buf.toString("utf8");
  const clipped = buf.subarray(0, max).toString("utf8");
  return `${clipped}\n\n[SKILL.md truncated: ${buf.length - max} bytes removed]`;
}

function getEffectiveReasoning(input: {
  config: {
    enabled: boolean;
    effort: string;
    exposeToClient: boolean;
    openaiSummary: string | null;
    anthropicBudgetTokens: number | null;
    googleThinkingBudget: number | null;
  };
  resolved: {
    modelType: string;
    providerModelId: string;
    capabilities: { reasoning: boolean };
  };
  requestedEffort?: string;
}) {
  const webToolsEnabled = Boolean(getConfig().webTools?.enabled);
  const webSearchIsEnabled =
    webToolsEnabled &&
    (input.resolved.modelType === "openai_responses" ||
      (input.resolved.modelType === "vercel_ai_gateway" &&
        input.resolved.providerModelId.startsWith("openai/")));

  const allowed = allowedReasoningEfforts({
    modelType: input.resolved.modelType,
    providerModelId: input.resolved.providerModelId,
    webToolsEnabled,
  });
  const normalized = normalizeReasoningEffort(input.requestedEffort, allowed);
  const requested = String(input.requestedEffort ?? "").trim().toLowerCase();

  // If the user explicitly asked for minimal but web_search is enabled, degrade to low
  // (minimal is not compatible with web_search).
  if (webSearchIsEnabled && requested === "minimal") {
    const coercedEffort = "low" as ReasoningEffort;
    return {
      requestedEffort: input.requestedEffort ?? "",
      normalizedEffort: normalized,
      effectiveEffort: coercedEffort,
      effectiveReasoning: {
        ...input.config,
        effort: coercedEffort,
      },
    };
  }

  const effectiveEffort =
    input.config.enabled && input.resolved.capabilities.reasoning
      ? normalized === "auto"
        ? input.config.effort
        : normalized
      : input.config.effort;
  const coercedEffort = effectiveEffort as ReasoningEffort;

  return {
    requestedEffort: input.requestedEffort ?? "",
    normalizedEffort: normalized,
    effectiveEffort,
    effectiveReasoning: {
      ...input.config,
      effort: coercedEffort,
    },
  };
}

function needsMemoryContext(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (/\s/.test(trimmed)) return false;
  const stripped = trimmed.replace(/[.!?,;:]+$/g, "");
  if (!stripped) return true;
  return /^[A-Za-z][A-Za-z'-]*$/.test(stripped);
}

// shouldForceMemoryAnswerTool moved to src/server/memory-answer-routing.ts

function isAgendaMutation(action: AgendaActionInput["action"]) {
  return action !== "list";
}

function uiTextResponse(input: {
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

function uiTextContinuationStream(input: {
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

function uiMemoryPromptResponse(input: {
  content: string;
  messageMetadata?: RemcoChatMessageMetadata;
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

  return createUIMessageStreamResponse({ stream });
}

function uiMemoryAnswerResponse(input: {
  answer: string;
  messageMetadata?: RemcoChatMessageMetadata;
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

  return createUIMessageStreamResponse({ stream });
}

function uiBashToolResponse(input: {
  command: string;
  result: { stdout: string; stderr: string; exitCode: number };
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
        toolName: "bash",
        input: { command: input.command },
      });
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: input.result,
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

function uiSkillsActivateResponse(input: {
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

function uiWeatherResponse(input: {
  location: string;
  messageMetadata?: RemcoChatMessageMetadata;
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
        const message =
          err instanceof Error ? err.message : "Failed to fetch weather.";
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

  return createUIMessageStreamResponse({ stream });
}

function uiWeatherForecastResponse(input: {
  location: string;
  messageMetadata?: RemcoChatMessageMetadata;
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
        const message =
          err instanceof Error ? err.message : "Failed to fetch forecast.";
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

  return createUIMessageStreamResponse({ stream });
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

function uiAgendaResponse(input: {
  profileId: string;
  command: AgendaActionInput;
  viewerTimeZone?: string;
  messageMetadata?: RemcoChatMessageMetadata;
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
        const message =
          err instanceof Error ? err.message : "Failed to update agenda.";
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

  return createUIMessageStreamResponse({ stream });
}

function uiOvNlResponse(input: {
  command: { action: string; args?: Record<string, unknown> };
  executeOvGateway: (input: unknown) => Promise<unknown>;
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
        toolName: "ovNlGateway",
        input: {
          action: input.command.action,
          args: input.command.args ?? {},
        },
      });
      try {
        const output = await input.executeOvGateway({
          action: input.command.action,
          args: input.command.args ?? {},
        });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
        const noMatchQuestion = ovConstraintNoMatchQuestion(output);
        if (noMatchQuestion) {
          writer.write({ type: "text-start", id: messageId });
          writer.write({
            type: "text-delta",
            id: messageId,
            delta: noMatchQuestion,
          });
          writer.write({ type: "text-end", id: messageId });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to execute ovNlGateway.";
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText: message,
        });
        writer.write({ type: "text-start", id: messageId });
        writer.write({
          type: "text-delta",
          id: messageId,
          delta: `OV NL error: ${message}`,
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

async function tryOvIntentFastPath(input: {
  enabled: boolean;
  shouldTry: boolean;
  explicitSkillActivationOnly: boolean;
  executeOvGateway: ((input: unknown) => Promise<unknown>) | null;
  text: string;
  previousUserText: string;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}): Promise<Response | null> {
  if (!input.enabled) return null;
  if (!input.shouldTry) return null;
  if (input.explicitSkillActivationOnly) return null;
  if (typeof input.executeOvGateway !== "function") return null;

  const routed = await runOvFromUserText({
    text: input.text,
    context: {
      previousUserText: input.previousUserText,
      lastOvOutput: lastOvOutputFromMessages(input.messages),
    },
  });

  if (!routed.ok) {
    const confidence = typeof routed.confidence === "number" ? routed.confidence : 0;
    const missing = Array.isArray(routed.missing)
      ? routed.missing.map((m) => String(m ?? "").trim()).filter(Boolean)
      : [];
    const canClarifyFastPath =
      confidence >= 0.7 &&
      missing.some((slot) =>
        ["station", "from", "to", "from/to window", "ctxRecon"].includes(slot)
      );

    if (canClarifyFastPath && routed.clarification.trim()) {
      logEvent("info", "ov_intent_clarification", {
        reason: "missing_required",
        confidence,
        missing,
      });
      return uiTextResponse({
        text: routed.clarification.trim(),
        messageMetadata: input.messageMetadata,
        headers: input.headers,
      });
    }
    logEvent("info", "ov_intent_parse_failed", {
      reason: canClarifyFastPath ? "missing_required" : "parse_failed",
      confidence,
      missing,
    });
    return null;
  }

  logEvent("info", "ov_intent_parse_success", {
    action: routed.action,
    confidence: routed.confidence,
    isFollowUp: routed.isFollowUp,
  });
  return uiOvNlResponse({
    command: {
      action: routed.action,
      args: routed.args,
    },
    executeOvGateway: input.executeOvGateway,
    messageMetadata: input.messageMetadata,
    headers: input.headers,
  });
}

function hash8(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const WEB_TOOL_NAMES = new Set([
  "perplexity_search",
  "web_search",
  "web_fetch",
  "google_search",
  "url_context",
  "exa_search",
  "brave_search",
]);

function isWebToolName(toolName: string) {
  return WEB_TOOL_NAMES.has(toolName);
}

function formatToolErrorsForPrompt(toolErrors: ToolStreamError[]) {
  const lines = toolErrors
    .slice(0, 5)
    .map((e) => {
      const name = e.toolName ? `${e.toolName}` : "unknown_tool";
      const stage = e.stage === "input" ? "input" : "output";
      const msg = String(e.errorText ?? "").trim() || "Tool failed.";
      return `- ${name} (${stage}): ${msg}`;
    });

  return [
    "A tool call failed during the previous step.",
    "Do not call any tools now. Respond with a helpful explanation and next steps, in plain text.",
    "",
    "Errors:",
    ...lines,
  ].join("\n");
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequestBody;
  const isRegenerate = Boolean(body.regenerate);
  const config = getConfig();
  const viewerTimeZoneHeader = String(
    req.headers.get("x-remcochat-viewer-timezone") ?? ""
  ).trim();
  const viewerTimeZone =
    viewerTimeZoneHeader && isValidTimeZone(viewerTimeZoneHeader)
      ? viewerTimeZoneHeader
      : undefined;

  if (!body.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  const profile = getProfile(body.profileId);
  const isTemporary = Boolean(body.temporary);

  const now = new Date().toISOString();
  const lastUserMessageId =
    [...body.messages].reverse().find((m) => m.role === "user")?.id ?? "";
  const lastUserText = lastUserMessageId
    ? messageText(
        [...body.messages].reverse().find((m) => m.id === lastUserMessageId)!
      )
    : "";
  const previousUserText = previousUserMessageText(body.messages, lastUserMessageId);
  const stopAfterTimezones = isTimezonesUserQuery(lastUserText);
  const stopAfterCurrentDateTime = isCurrentDateTimeUserQuery(lastUserText);
  const explicitBashCommandFromUser = extractExplicitBashCommand(lastUserText);
  const explicitBashNoExtraText = /\bdo not add any other text\b/i.test(lastUserText);

  const memorizeDecision = parseMemorizeDecision(lastUserText);
  const directMemoryCandidate = parseMemoryAddCommand(lastUserText);
  const canRouteIntent = !isRegenerate && memorizeDecision == null;
  const routerContext = lastAssistantContext(body.messages);
  let routedIntent: IntentRoute | null = null;

  const needsViewerTimeZoneForAgenda = (command: AgendaActionInput) => {
    if (viewerTimeZone) return false;
    switch (command.action) {
      case "create":
        return !command.timezone;
      case "list":
        return !command.range.timezone;
      case "update":
        return (
          !command.patch.timezone &&
          Boolean(
            command.match?.date ||
              command.match?.time ||
              command.patch.date ||
              command.patch.time
          )
        );
      case "delete":
      case "share":
      case "unshare":
        return Boolean(command.match?.date || command.match?.time);
      default:
        return true;
    }
  };

  if (isTemporary) {
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

    if (canRouteIntent) {
      if (directMemoryCandidate) {
        return uiTextResponse({
          text: "Temporary chats do not save memory. Turn off Temp, then ask me to remember something and confirm when asked.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
          },
        });
      }

      let routed: Awaited<ReturnType<typeof routeIntent>>;
      try {
        routed = await routeIntent({ text: lastUserText, context: routerContext });
      } catch (err) {
        console.error("Intent router failed", err);
        routed = { intent: "none", confidence: 0 };
      }
      routedIntent = routed;

      if (routed && routed.intent === "memory_add") {
        return uiTextResponse({
          text: "Temporary chats do not save memory. Turn off Temp, then ask me to remember something and confirm when asked.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
          },
        });
      }
      if (routed && routed.intent === "weather_current") {
        let resolvedForTools;
        try {
          resolvedForTools = await resolveModel();
        } catch (err) {
          return Response.json(
            {
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to load model.",
            },
            { status: 500 }
          );
        }
        if (resolvedForTools.capabilities.tools) {
          return uiWeatherResponse({
            location: routed.location,
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
            },
          });
        }
      }
      if (routed && routed.intent === "weather_forecast") {
        let resolvedForTools;
        try {
          resolvedForTools = await resolveModel();
        } catch (err) {
          return Response.json(
            {
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to load model.",
            },
            { status: 500 }
          );
        }
        if (resolvedForTools.capabilities.tools) {
          return uiWeatherForecastResponse({
            location: routed.location,
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
            },
          });
        }
      }
      if (routed && routed.intent === "agenda") {
        let agendaResult: Awaited<ReturnType<typeof routeAgendaCommand>> = {
          ok: false,
          error: "Agenda routing failed.",
        };
        try {
          agendaResult = await routeAgendaCommand({ text: lastUserText });
        } catch (err) {
          console.error("Agenda intent extraction failed (temporary chat fallback)", err);
        }
        if (!agendaResult.ok) {
          // Fall back to the main LLM flow (tool calling) instead of erroring the chat.
          // The displayAgenda tool itself enforces temporary chat constraints.
        } else {
        if (needsViewerTimeZoneForAgenda(agendaResult.command)) {
          return uiTextResponse({
            text:
              "I couldn't determine your timezone. Tell me your timezone (example: Europe/Amsterdam) or include it in your request, then try again.",
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
            },
          });
        }
          if (isAgendaMutation(agendaResult.command.action)) {
            return uiTextResponse({
              text: "Temporary chats do not save agenda items. Turn off Temp to manage your agenda.",
              messageMetadata: {
                createdAt: now,
                turnUserMessageId: lastUserMessageId || undefined,
              },
            });
          }
          return uiAgendaResponse({
            profileId: profile.id,
            command: agendaResult.command,
            viewerTimeZone,
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
            },
          });
        }
      }
    }

    try {
      resolved = await resolveModel();
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to load model." },
        { status: 500 }
      );
    }

    const profileInstructions = (profile.customInstructions ?? "").trim();

    const reasoningSelection = getEffectiveReasoning({
      config: config.reasoning,
      resolved,
      requestedEffort: body.reasoning?.effort,
    });

    const webTools = resolved.capabilities.tools
      ? createWebTools({
          providerId: resolved.providerId,
          modelType: resolved.modelType,
          providerModelId: resolved.providerModelId,
        })
      : { enabled: false, tools: {} };

    const temporaryKey =
      typeof body.temporarySessionId === "string" && body.temporarySessionId.trim()
        ? `tmp:${body.temporarySessionId.trim()}`
        : "";

    if (explicitBashNoExtraText && explicitBashCommandFromUser && temporaryKey) {
      const bashResult = await runExplicitBashCommand({
        request: req,
        sessionKey: temporaryKey,
        command: explicitBashCommandFromUser,
      });
      if (bashResult.enabled) {
        return uiBashToolResponse({
          headers: {
            "x-remcochat-api-version": REMCOCHAT_API_VERSION,
            "x-remcochat-temporary": "1",
            "x-remcochat-profile-id": profile.id,
            "x-remcochat-bash-tools-enabled": "1",
            "x-remcochat-bash-tools": "bash",
          },
          command: explicitBashCommandFromUser,
          result: {
            stdout: bashResult.stdout,
            stderr: bashResult.stderr,
            exitCode: bashResult.exitCode,
          },
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
          },
        });
      }
    }

    const bashTools =
      resolved.capabilities.tools && temporaryKey
        ? await createBashTools({ request: req, sessionKey: temporaryKey })
        : { enabled: false, tools: {} };

    const explicitBashCommand = bashTools.enabled
      ? explicitBashCommandFromUser
      : null;

	    const skillsRegistry = getSkillsRegistry();
	    const skillsTools = createSkillsTools({ enabled: Boolean(skillsRegistry) });
	    const ovNlTools = createOvNlTools({
	      request: req,
	    });
      const explicitSkillCandidate = explicitSkillNameCandidate(lastUserText);
      if (
        explicitSkillCandidate === "ov-nl-travel" &&
        skillsRegistry?.get("ov-nl-travel") &&
        !ovNlTools.enabled
      ) {
        const cfg = getConfig().ovNl;
        const required = String(process.env.REMCOCHAT_ADMIN_TOKEN ?? "").trim();
        const provided = String(adminTokenFromRequest(req) ?? "").trim();

        let hint = "";
        if (!cfg || !cfg.enabled) {
          hint =
            "De OV NL tool staat niet aan in je server config. Voeg een [app.ov_nl] sectie toe met enabled=true (en access=\"lan\" voor LAN-gebruik) in je actieve config.toml, en herstart de server.";
        } else if (cfg.access === "localhost" && !isLocalhostRequest(req)) {
          hint =
            "De OV NL tool staat op access=\"localhost\" en is niet beschikbaar via LAN. Zet app.ov_nl.access=\"lan\" en herstart de server.";
        } else if (cfg.access === "lan" && !isRequestAllowedByAdminPolicy(req)) {
          hint = !required
            ? "Server-side REMCOCHAT_ADMIN_TOKEN ontbreekt. Zet REMCOCHAT_ADMIN_TOKEN in je productie .env en herstart de stack."
            : !provided
              ? "Je request bevat geen admin-token. Klik op het sleutel-icoon (Admin access), plak REMCOCHAT_ADMIN_TOKEN, en klik op 'Save locally'."
              : "Je request bevat wel een admin-token, maar die wordt niet geaccepteerd (token mismatch). Klik op het sleutel-icoon (Admin access), 'Clear', plak opnieuw de server token, en klik op 'Save locally'.";
        } else {
          hint =
            "De OV NL tool is niet ingeschakeld voor dit request (onbekende reden). Controleer je actieve config.toml en herstart de server.";
        }
        return uiTextResponse({
          text:
            'De skill "/ov-nl-travel" is wel geinstalleerd, maar is nu niet beschikbaar omdat de OV NL tool (ovNlGateway) niet is ingeschakeld voor jouw request.\n\n' +
            hint,
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
          },
          headers: {
            "x-remcochat-api-version": REMCOCHAT_API_VERSION,
            "x-remcochat-temporary": "1",
            "x-remcochat-profile-id": profile.id,
            "x-remcochat-ov-nl-tools-enabled": "0",
            "x-remcochat-ov-nl-tools": "",
          },
        });
      }
	    const availableSkills =
	      skillsRegistry == null
	        ? []
	        : ovNlTools.enabled
          ? skillsRegistry.list()
          : skillsRegistry.list().filter((skill) => skill.name !== "ov-nl-travel");
    const skillNames = new Set(availableSkills.map((s) => s.name));
    const skillInvocation = stripExplicitSkillInvocationFromMessages({
      messages: stripWebToolPartsFromMessages(body.messages),
      skillNames,
    });
    const explicitSkillActivationOnly = isExplicitSkillActivationOnlyPrompt({
      messages: skillInvocation.messages,
      explicitSkillName: skillInvocation.explicitSkillName,
    });

    if (explicitSkillActivationOnly && skillInvocation.explicitSkillName) {
      const activateTool = (skillsTools.tools as {
        skillsActivate?: {
          execute?: (args: { name: string }) => Promise<unknown>;
        };
      }).skillsActivate;

      if (typeof activateTool?.execute === "function") {
        return uiSkillsActivateResponse({
          skillName: skillInvocation.explicitSkillName,
          language: profile.uiLanguage,
          executeActivate: activateTool.execute,
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
          },
          headers: {
            "x-remcochat-api-version": REMCOCHAT_API_VERSION,
            "x-remcochat-temporary": "1",
            "x-remcochat-profile-id": profile.id,
          },
        });
      }
    }

    const hueSkillRelevant = skillInvocation.explicitSkillName === "hue-instant-control";
    const hueGatewayTools = createHueGatewayTools({
      request: req,
      isTemporary: true,
      skillRelevant: hueSkillRelevant,
      temporarySessionId:
        typeof body.temporarySessionId === "string" ? body.temporarySessionId.trim() : "",
      turnUserMessageId: lastUserMessageId || "",
    });
    const ovNlPolicy = computeOvNlRoutingPolicy({
      routedIntent,
      explicitSkillName: skillInvocation.explicitSkillName,
    });
    const forceOvNlGatewayTool = ovNlPolicy.forceFastPath;
    const ovGatewayExecute = (
      ovNlTools.tools as {
        ovNlGateway?: { execute?: (input: unknown) => Promise<unknown> };
      }
    ).ovNlGateway?.execute;
    const ovFastPath = await tryOvIntentFastPath({
      enabled: ovNlTools.enabled,
      shouldTry: !explicitBashCommand && forceOvNlGatewayTool,
      explicitSkillActivationOnly,
      executeOvGateway: typeof ovGatewayExecute === "function" ? ovGatewayExecute : null,
      text: lastUserTextFromMessages(skillInvocation.messages),
      previousUserText,
      messages: skillInvocation.messages,
      messageMetadata: {
        createdAt: now,
        turnUserMessageId: lastUserMessageId || undefined,
      },
      headers: {
        "x-remcochat-api-version": REMCOCHAT_API_VERSION,
        "x-remcochat-temporary": "1",
        "x-remcochat-profile-id": profile.id,
      },
    });
    if (ovFastPath) return ovFastPath;

    const forcedToolChoice = explicitBashCommand
      ? ({ type: "tool", toolName: "bash" } as const)
      : null;

    let system = buildSystemPrompt({
      isTemporary: true,
      chatInstructions: "",
      chatInstructionsRevision: 1,
      profileInstructions,
      profileInstructionsRevision: profile.customInstructionsRevision,
      memoryEnabled: false,
      memoryLines: [],
      skillsEnabled: Boolean(skillsRegistry),
      availableSkills,
      activatedSkillNames: [],
      toolsEnabled: resolved.capabilities.tools,
      webToolsEnabled: webTools.enabled,
      bashToolsEnabled: bashTools.enabled,
      bashToolsProvider: config.bashTools?.provider,
      bashToolsRuntime: config.bashTools?.sandbox?.runtime,
      attachmentsEnabled: config.attachments.enabled,
      ovNlToolsEnabled: ovNlTools.enabled,
      ovNlToolAllowed: ovNlPolicy.toolAllowedForPrompt,
      ovNlToolConfidence: ovNlPolicy.routerConfidence ?? undefined,
    });

    if (skillInvocation.explicitSkillName) {
      system = [
        system,
        `Explicit skill invocation detected: /${skillInvocation.explicitSkillName}`,
        `Call skillsActivate first with name="${skillInvocation.explicitSkillName}".`,
      ].join("\n\n");
    }

    if (explicitBashCommand) {
      system = [
        system,
        "The user provided an explicit shell command and requested using the bash tool.",
        "Call the bash tool with the command exactly as written, then stop. Do not add any other text unless the user asked.",
        `Command: \`${explicitBashCommand}\``,
      ].join("\n\n");
    }

    if (skillInvocation.explicitSkillName && !resolved.capabilities.tools) {
      const record = skillsRegistry?.get(skillInvocation.explicitSkillName) ?? null;
      if (record) {
        const maxBytes = config.skills?.maxSkillMdBytes ?? 200_000;
        const skillMd = readFileForPrompt(record.skillMdPath, maxBytes);
        system = [
          system,
          `Explicit skill invocation detected (/` +
            `${record.name}). Tool calling is unavailable for this model, so the skill's SKILL.md is injected below.`,
          skillMd,
        ].join("\n\n");
      }
    }

    let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
    try {
      const withAttachments = await replaceAttachmentPartsWithExtractedText({
        profileId: profile.id,
        messages: skillInvocation.messages,
      });
      modelMessages = await convertToModelMessages(withAttachments, {
        ignoreIncompleteToolCalls: true,
      });
    } catch (err) {
      return uiTextResponse({
        headers: { "x-remcochat-api-version": REMCOCHAT_API_VERSION },
        text:
          err instanceof Error
            ? `Attachment processing error: ${err.message}`
            : "Attachment processing error.",
      });
    }

	    const chatTools = createTools({
	      profileId: profile.id,
	      isTemporary: true,
	      memoryEnabled: false,
	      viewerTimeZone,
	      toolContext: { lastUserText, previousUserText },
	      model: resolved.capabilities.tools ? resolved.model : undefined,
	      supportsTemperature: resolved.capabilities.temperature,
	    });
    const maxSteps = bashTools.enabled ? 20 : webTools.enabled ? 12 : 5;
    const providerOptions = createProviderOptionsForWebTools({
      modelType: resolved.modelType,
      providerModelId: resolved.providerModelId,
      webToolsEnabled: webTools.enabled,
      capabilities: resolved.capabilities,
      reasoning: reasoningSelection.effectiveReasoning,
    });

	    const headers = {
	      "x-remcochat-api-version": REMCOCHAT_API_VERSION,
	      "x-remcochat-temporary": "1",
	      "x-remcochat-profile-id": profile.id,
      "x-remcochat-provider-id": resolved.providerId,
      "x-remcochat-model-type": resolved.modelType,
      "x-remcochat-provider-model-id": resolved.providerModelId,
      "x-remcochat-model-id": resolved.modelId,
      "x-remcochat-reasoning-enabled":
        config.reasoning.enabled && resolved.capabilities.reasoning ? "1" : "0",
      "x-remcochat-reasoning-effort":
        config.reasoning.enabled && resolved.capabilities.reasoning
          ? reasoningSelection.effectiveEffort
          : "",
      "x-remcochat-reasoning-effort-requested":
        reasoningSelection.requestedEffort,
      "x-remcochat-reasoning-effort-effective":
        config.reasoning.enabled && resolved.capabilities.reasoning
          ? reasoningSelection.effectiveEffort
          : "",
      "x-remcochat-reasoning-exposed": config.reasoning.exposeToClient ? "1" : "0",
      "x-remcochat-profile-instructions-rev": String(
        profile.customInstructionsRevision
      ),
      "x-remcochat-chat-instructions-rev": "0",
      "x-remcochat-profile-instructions-len": String(profileInstructions.length),
      "x-remcochat-profile-instructions-hash": hash8(profileInstructions),
      "x-remcochat-chat-instructions-len": "0",
      "x-remcochat-chat-instructions-hash": hash8(""),
	      "x-remcochat-web-tools-enabled": webTools.enabled ? "1" : "0",
	      "x-remcochat-web-tools": Object.keys(webTools.tools).join(","),
	      "x-remcochat-bash-tools-enabled": bashTools.enabled ? "1" : "0",
	      "x-remcochat-bash-tools": Object.keys(bashTools.tools).join(","),
        "x-remcochat-ov-nl-tools-enabled": ovNlTools.enabled ? "1" : "0",
        "x-remcochat-ov-nl-tools": Object.keys(ovNlTools.tools).join(","),
	    };

    const baseMessageMetadata = {
      createdAt: now,
      turnUserMessageId: lastUserMessageId || undefined,
      profileInstructionsRevision: profile.customInstructionsRevision,
      chatInstructionsRevision: 0,
    };

    const messageMetadata = ({
      part,
    }: {
      part: TextStreamPart<StreamTextToolSet>;
    }) => {
      if (part.type === "start") return baseMessageMetadata;
      if (part.type === "finish") {
        return {
          ...baseMessageMetadata,
          usage: part.totalUsage,
        };
      }
      return undefined;
    };

    const result = streamText({
      model: resolved!.model,
      system,
      messages: modelMessages,
      ...(resolved!.capabilities.temperature && !resolved!.capabilities.reasoning
        ? { temperature: 0 }
        : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(resolved!.capabilities.tools
        ? {
          ...(forcedToolChoice ? { toolChoice: forcedToolChoice } : {}),
	          stopWhen: [
	            hasToolCall("displayWeather"),
	            hasToolCall("displayWeatherForecast"),
	            ...(stopAfterCurrentDateTime
	              ? [hasToolCall("displayCurrentDateTime")]
	              : []),
	            ...(stopAfterTimezones ? [hasToolCall("displayTimezones")] : []),
	            hasToolCall("displayNotes"),
	            hasToolCall("displayMemoryPrompt"),
	            hasToolCall("displayMemoryAnswer"),
            hasToolCall("displayList"),
            hasToolCall("displayListsOverview"),
            hasToolCall("displayAgenda"),
            hasToolCall("displayUrlSummary"),
            hasToolCall("summarizeURL"),
            stepCountIs(maxSteps),
          ],
	          tools: {
	            ...chatTools,
	            ...webTools.tools,
	            ...bashTools.tools,
	            ...skillsTools.tools,
	            ...hueGatewayTools.tools,
              ...ovNlTools.tools,
	          } as StreamTextToolSet,
	        }
	      : { stopWhen: [stepCountIs(5)] }),
	    });

    const shouldAutoContinuePerplexity =
      webTools.enabled &&
      Object.prototype.hasOwnProperty.call(webTools.tools, "perplexity_search");

    const baseUIStream = result.toUIMessageStream({
      generateMessageId: nanoid,
      messageMetadata,
      sendReasoning: config.reasoning.exposeToClient,
    });

    const shouldInspectForContinuation = shouldAutoContinuePerplexity;
    if (!shouldInspectForContinuation) {
      return createUIMessageStreamResponse({
        headers,
        stream: createUIMessageStreamWithToolErrorContinuation({
          stream: baseUIStream,
          shouldContinue: () => false,
          createContinuationStream: async () => null,
        }),
      });
    }

    return createUIMessageStreamResponse({
      headers,
      stream: createUIMessageStreamWithDeferredContinuation({
        stream: baseUIStream,
          collect: (inspectionStream) =>
            collectUIMessageChunks(inspectionStream, {
              isWebToolName,
              captureChunks: false,
            }),
          createContinuationStream: async (collected) => {
            const perplexityOutput = collected.webToolOutputs.get("perplexity_search");
            const needsPerplexityContinuation =
              collected.finishReason === "tool-calls" &&
              !collected.hasUserVisibleOutput &&
              perplexityOutput != null;

            if (!needsPerplexityContinuation) {
              if (collected.toolErrors.length === 0) return null;

            const continuationMessages = modelMessages.concat([
              {
                role: "user" as const,
                content: [
                  {
                    type: "text" as const,
                    text: formatToolErrorsForPrompt(collected.toolErrors),
                  },
                ],
              },
            ]);

            const continued = streamText({
              model: resolved!.model,
              system,
              messages: continuationMessages,
              toolChoice: "none",
	              tools: {
	                ...chatTools,
	                ...webTools.tools,
	                ...bashTools.tools,
	                ...skillsTools.tools,
	                ...hueGatewayTools.tools,
                  ...ovNlTools.tools,
	              } as StreamTextToolSet,
              ...(resolved!.capabilities.temperature && !resolved!.capabilities.reasoning
                ? { temperature: 0 }
                : {}),
              ...(providerOptions ? { providerOptions } : {}),
              stopWhen: [stepCountIs(5)],
            });

            const continuedStream = continued.toUIMessageStream({
              generateMessageId: nanoid,
              messageMetadata,
              sendReasoning: config.reasoning.exposeToClient,
            });
            const safeContinuedStream = createUIMessageStreamWithToolErrorContinuation({
              stream: continuedStream,
              shouldContinue: () => false,
              createContinuationStream: async () => null,
            });
            return stripUIMessageStream(safeContinuedStream, { dropStart: true });
          }

          const formatted = formatPerplexitySearchResultsForPrompt(perplexityOutput, {
            maxResults: 5,
            maxSnippetChars: 420,
          });

          if (!formatted.ok) {
            return uiTextContinuationStream({
              text: `Web search error: ${formatted.errorText}`,
              messageMetadata: baseMessageMetadata,
            });
          }

          const continuationText = [
            "Web search results (from perplexity_search). Use these to answer the user's last message. Include source URLs where relevant.",
            lastUserText ? `User question: ${lastUserText}` : "",
            formatted.text,
          ]
            .filter(Boolean)
            .join("\n\n");

          const continuationMessages = modelMessages.concat([
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: continuationText }],
            },
          ]);

	          const tools = {
	            ...chatTools,
	            ...webTools.tools,
	            ...bashTools.tools,
	          } as StreamTextToolSet;
	          delete tools.perplexity_search;

          const continued = streamText({
            model: resolved!.model,
            system,
            messages: continuationMessages,
            ...(resolved!.capabilities.temperature && !resolved!.capabilities.reasoning
              ? { temperature: 0 }
              : {}),
            ...(providerOptions ? { providerOptions } : {}),
            ...(resolved!.capabilities.tools
              ? {
                  ...(forcedToolChoice ? { toolChoice: forcedToolChoice } : {}),
	                  stopWhen: [
                    hasToolCall("displayWeather"),
                    hasToolCall("displayWeatherForecast"),
                    ...(stopAfterCurrentDateTime
                      ? [hasToolCall("displayCurrentDateTime")]
                      : []),
                    ...(stopAfterTimezones ? [hasToolCall("displayTimezones")] : []),
                    hasToolCall("displayNotes"),
                    hasToolCall("displayMemoryPrompt"),
                    hasToolCall("displayMemoryAnswer"),
                    hasToolCall("displayList"),
	                    hasToolCall("displayListsOverview"),
	                    hasToolCall("displayAgenda"),
	                    hasToolCall("displayUrlSummary"),
	                    hasToolCall("summarizeURL"),
	                    stepCountIs(maxSteps),
	                  ],
                  tools,
                }
              : { stopWhen: [stepCountIs(5)] }),
          });

          const continuedStream = continued.toUIMessageStream({
            generateMessageId: nanoid,
            messageMetadata,
            sendReasoning: config.reasoning.exposeToClient,
          });
          return stripUIMessageStream(continuedStream, { dropStart: true });
        },
      }),
    });
  }

  if (!body.chatId) {
    return Response.json({ error: "Missing chatId." }, { status: 400 });
  }

  let chat: ReturnType<typeof getChatForViewer>;
  try {
    chat = getChatForViewer(profile.id, body.chatId);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Chat not accessible." },
      { status: 400 }
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

  if (pendingMemory && memorizeDecision) {
    if (memorizeDecision === "cancel") {
      clearPendingMemory(effectiveChat.id);
      return uiTextResponse({
        text: "Okay, I won't save that.",
        messageMetadata: {
          createdAt: now,
          turnUserMessageId: lastUserMessageId || undefined,
          profileInstructionsRevision: currentProfileRevision,
          chatInstructionsRevision: currentChatRevision,
        },
      });
    }

    if (!profile.memoryEnabled) {
      clearPendingMemory(effectiveChat.id);
      return uiTextResponse({
        text: "Memory is currently off for this profile. Enable it in Profile Settings, then try again.",
        messageMetadata: {
          createdAt: now,
          turnUserMessageId: lastUserMessageId || undefined,
          profileInstructionsRevision: currentProfileRevision,
          chatInstructionsRevision: currentChatRevision,
        },
      });
    }

    try {
      createMemoryItem({
        profileId: profile.id,
        content: pendingMemory.content,
      });
      clearPendingMemory(effectiveChat.id);
      return uiMemoryAnswerResponse({
        answer: "Saved to memory.",
        messageMetadata: {
          createdAt: now,
          turnUserMessageId: lastUserMessageId || undefined,
          profileInstructionsRevision: currentProfileRevision,
          chatInstructionsRevision: currentChatRevision,
        },
      });
    } catch (err) {
      clearPendingMemory(effectiveChat.id);
      return uiTextResponse({
        text:
          err instanceof Error ? err.message : "Failed to save memory item.",
        messageMetadata: {
          createdAt: now,
          turnUserMessageId: lastUserMessageId || undefined,
          profileInstructionsRevision: currentProfileRevision,
          chatInstructionsRevision: currentChatRevision,
        },
      });
    }
  }

  if (!pendingMemory && memorizeDecision) {
    const previousUserText = previousUserMessageText(
      body.messages,
      lastUserMessageId
    );
    const previousCandidate = parseMemoryAddCommand(previousUserText);
    if (previousCandidate) {
      if (memorizeDecision === "cancel") {
        return uiTextResponse({
          text: "Okay, I won't save that.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }

      if (!profile.memoryEnabled) {
        return uiTextResponse({
          text: "Memory is currently off for this profile. Enable it in Profile Settings, then try again.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }

      if (needsMemoryContext(previousCandidate)) {
        return uiTextResponse({
          text:
            "I need a bit more context to store this memory. Please restate it as a short sentence (who/what/why), then ask me to remember it again.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }

      try {
        createMemoryItem({
          profileId: profile.id,
          content: previousCandidate,
        });
        return uiMemoryAnswerResponse({
          answer: "Saved to memory.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      } catch (err) {
        return uiTextResponse({
          text:
            err instanceof Error ? err.message : "Failed to save memory item.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
    }

    return uiTextResponse({
      text: "I don't have anything pending to confirm. Ask me to remember something first, then confirm when prompted.",
      messageMetadata: {
        createdAt: now,
        turnUserMessageId: lastUserMessageId || undefined,
        profileInstructionsRevision: currentProfileRevision,
        chatInstructionsRevision: currentChatRevision,
      },
    });
  }

  if (canRouteIntent) {
    if (directMemoryCandidate) {
      if (!profile.memoryEnabled) {
        return uiTextResponse({
          text: "Memory is currently off for this profile. Enable it in Profile Settings, then try again.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
      if (needsMemoryContext(directMemoryCandidate)) {
        return uiTextResponse({
          text:
            "I need a bit more context to store this memory. Please add a short sentence (who/what/why) so it will be useful later.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
      try {
        const pending = upsertPendingMemory({
          chatId: effectiveChat.id,
          profileId: profile.id,
          content: directMemoryCandidate,
        });
        return uiMemoryPromptResponse({
          content: pending.content,
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      } catch (err) {
        return uiTextResponse({
          text:
            err instanceof Error
              ? err.message
              : "Failed to prepare memory confirmation.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
    }

    let routed: Awaited<ReturnType<typeof routeIntent>>;
    try {
      routed = await routeIntent({ text: lastUserText, context: routerContext });
    } catch (err) {
      console.error("Intent router failed", err);
      routed = { intent: "none", confidence: 0 };
    }
    routedIntent = routed;

      if (routed && routed.intent === "memory_add") {
        if (!profile.memoryEnabled) {
          return uiTextResponse({
            text: "Memory is currently off for this profile. Enable it in Profile Settings, then try again.",
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
              profileInstructionsRevision: currentProfileRevision,
              chatInstructionsRevision: currentChatRevision,
            },
          });
        }
        if (needsMemoryContext(routed.memoryCandidate)) {
          return uiTextResponse({
            text:
              "I need a bit more context to store this memory. Please add a short sentence (who/what/why) so it will be useful later.",
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
              profileInstructionsRevision: currentProfileRevision,
              chatInstructionsRevision: currentChatRevision,
            },
          });
        }
        try {
          const pending = upsertPendingMemory({
            chatId: effectiveChat.id,
            profileId: profile.id,
            content: routed.memoryCandidate,
          });
          return uiMemoryPromptResponse({
            content: pending.content,
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
              profileInstructionsRevision: currentProfileRevision,
              chatInstructionsRevision: currentChatRevision,
            },
          });
      } catch (err) {
        return uiTextResponse({
          text:
            err instanceof Error
              ? err.message
              : "Failed to prepare memory confirmation.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
      }

    if (routed && routed.intent === "weather_current") {
      let resolvedForTools;
      try {
        resolvedForTools = await resolveModel();
      } catch (err) {
        return Response.json(
          {
            error:
              err instanceof Error ? err.message : "Failed to load model.",
          },
          { status: 500 }
        );
      }
      if (resolvedForTools.capabilities.tools) {
        return uiWeatherResponse({
          location: routed.location,
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
    }

    if (routed && routed.intent === "weather_forecast") {
      let resolvedForTools;
      try {
        resolvedForTools = await resolveModel();
      } catch (err) {
        return Response.json(
          {
            error:
              err instanceof Error ? err.message : "Failed to load model.",
          },
          { status: 500 }
        );
      }
      if (resolvedForTools.capabilities.tools) {
        return uiWeatherForecastResponse({
          location: routed.location,
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
    }

    if (routed && routed.intent === "agenda") {
      let agendaResult: Awaited<ReturnType<typeof routeAgendaCommand>> = {
        ok: false,
        error: "Agenda routing failed.",
      };
      try {
        agendaResult = await routeAgendaCommand({ text: lastUserText });
      } catch (err) {
        console.error("Agenda intent extraction failed (fallback to main chat)", err);
      }
      if (agendaResult.ok) {
        if (needsViewerTimeZoneForAgenda(agendaResult.command)) {
          return uiTextResponse({
            text:
              "I couldn't determine your timezone. Tell me your timezone (example: Europe/Amsterdam) or include it in your request, then try again.",
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
              profileInstructionsRevision: currentProfileRevision,
              chatInstructionsRevision: currentChatRevision,
            },
          });
        }
        if (isAgendaMutation(agendaResult.command.action)) {
          return uiAgendaResponse({
            profileId: profile.id,
            command: agendaResult.command,
            viewerTimeZone,
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
              profileInstructionsRevision: currentProfileRevision,
              chatInstructionsRevision: currentChatRevision,
            },
          });
        }
        return uiAgendaResponse({
          profileId: profile.id,
          command: agendaResult.command,
          viewerTimeZone,
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
    }
  }

  const memoryLines: string[] = [];
  if (profile.memoryEnabled) {
    const memory = listProfileMemory(profile.id);
    if (memory.length > 0) {
      const items = memory
        .slice(0, 50)
        .map((m) => m.content.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (items.length > 0) {
        memoryLines.push(...items.map((i) => `- ${i}`));
      }
    }
  }

  const storedProfileInstructions = (profile.customInstructions ?? "").trim();
  const chatInstructions = (effectiveChat.chatInstructions ?? "").trim();
  const promptProfileInstructions = chatInstructions ? "" : storedProfileInstructions;
  const profileInstructions = promptProfileInstructions;

  try {
    resolved = await resolveModel();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load model." },
      { status: 500 }
    );
  }

  const regenerateMessageId =
    typeof body.regenerateMessageId === "string" ? body.regenerateMessageId : "";

  const filteredMessages = body.messages.filter((m) => {
    if (regenerateMessageId && m.role === "assistant" && m.id === regenerateMessageId) {
      return false;
    }
    if (m.role !== "assistant") return true;
    const profileRev = m.metadata?.profileInstructionsRevision;
    const chatRev = m.metadata?.chatInstructionsRevision;

    if (typeof profileRev === "number" && profileRev !== currentProfileRevision) {
      return false;
    }
    if (typeof chatRev === "number" && chatRev !== currentChatRevision) {
      return false;
    }

    const missing = typeof profileRev !== "number" || typeof chatRev !== "number";
    if (missing && (currentProfileRevision !== 1 || currentChatRevision !== 1)) {
      return false;
    }

    return true;
  });

  const reasoningSelection = getEffectiveReasoning({
    config: config.reasoning,
    resolved,
    requestedEffort: body.reasoning?.effort,
  });

  const webTools = resolved.capabilities.tools
    ? createWebTools({
        providerId: resolved.providerId,
        modelType: resolved.modelType,
        providerModelId: resolved.providerModelId,
      })
    : { enabled: false, tools: {} };

  const bashTools = resolved.capabilities.tools
    ? await createBashTools({
        request: req,
        sessionKey: `chat:${effectiveChat.id}`,
      })
    : { enabled: false, tools: {} };

	  const skillsRegistry = getSkillsRegistry();
	  const ovNlTools = createOvNlTools({
	    request: req,
	  });
    const explicitSkillCandidate = explicitSkillNameCandidate(lastUserText);
	    if (
	      explicitSkillCandidate === "ov-nl-travel" &&
	      skillsRegistry?.get("ov-nl-travel") &&
	      !ovNlTools.enabled
	    ) {
	      const required = String(process.env.REMCOCHAT_ADMIN_TOKEN ?? "").trim();
	      const provided = String(adminTokenFromRequest(req) ?? "").trim();
	      const hint = !required
	        ? "Server-side REMCOCHAT_ADMIN_TOKEN ontbreekt. Zet REMCOCHAT_ADMIN_TOKEN in je productie .env en herstart de stack."
	        : !provided
	          ? "Je request bevat geen admin-token. Klik op het sleutel-icoon (Admin access), plak REMCOCHAT_ADMIN_TOKEN, en klik op 'Save locally'."
	          : "Je request bevat wel een admin-token, maar die wordt niet geaccepteerd (token mismatch). Klik op het sleutel-icoon (Admin access), 'Clear', plak opnieuw de server token, en klik op 'Save locally'.";
	      return uiTextResponse({
	        text:
	          'De skill "/ov-nl-travel" is wel geinstalleerd, maar is nu niet beschikbaar omdat de OV NL tool (ovNlGateway) niet is ingeschakeld voor jouw request.\n\n' +
	          hint,
	        messageMetadata: {
	          createdAt: now,
	          turnUserMessageId: lastUserMessageId || undefined,
	          profileInstructionsRevision: currentProfileRevision,
          chatInstructionsRevision: currentChatRevision,
        },
        headers: {
          "x-remcochat-api-version": REMCOCHAT_API_VERSION,
          "x-remcochat-temporary": "0",
          "x-remcochat-profile-id": profile.id,
          "x-remcochat-ov-nl-tools-enabled": "0",
          "x-remcochat-ov-nl-tools": "",
        },
      });
    }
	  const availableSkills =
	    skillsRegistry == null
	      ? []
      : ovNlTools.enabled
        ? skillsRegistry.list()
        : skillsRegistry.list().filter((skill) => skill.name !== "ov-nl-travel");
  const skillNames = new Set(availableSkills.map((s) => s.name));
  const skillInvocation = stripExplicitSkillInvocationFromMessages({
    messages: stripWebToolPartsFromMessages(filteredMessages),
    skillNames,
  });
  const explicitSkillActivationOnly = isExplicitSkillActivationOnlyPrompt({
    messages: skillInvocation.messages,
    explicitSkillName: skillInvocation.explicitSkillName,
  });

  if (skillInvocation.explicitSkillName) {
    try {
      recordActivatedSkillName({
        chatId: effectiveChat.id,
        skillName: skillInvocation.explicitSkillName,
      });
    } catch {}
  }

  if (explicitSkillActivationOnly && skillInvocation.explicitSkillName) {
    const activationTools = createSkillsTools({
      enabled: Boolean(skillsRegistry),
      chatId: effectiveChat.id,
    });
    const activateTool = (activationTools.tools as {
      skillsActivate?: {
        execute?: (args: { name: string }) => Promise<unknown>;
      };
    }).skillsActivate;

    if (typeof activateTool?.execute === "function") {
      return uiSkillsActivateResponse({
        skillName: skillInvocation.explicitSkillName,
        language: profile.uiLanguage,
        executeActivate: activateTool.execute,
        messageMetadata: {
          createdAt: now,
          turnUserMessageId: lastUserMessageId || undefined,
          profileInstructionsRevision: currentProfileRevision,
          chatInstructionsRevision: currentChatRevision,
        },
        headers: {
          "x-remcochat-api-version": REMCOCHAT_API_VERSION,
          "x-remcochat-temporary": "0",
          "x-remcochat-profile-id": profile.id,
          "x-remcochat-chat-id": effectiveChat.id,
        },
      });
    }
  }

  const wantsSkillsToolsSmokeTest =
    skillInvocation.explicitSkillName === "skills-system-validation" &&
    /\bskillsActivate\b/.test(lastUserText) &&
    /\bskillsReadResource\b/.test(lastUserText) &&
    resolved.capabilities.tools;

  if (wantsSkillsToolsSmokeTest && skillsRegistry) {
    const smokeTestSkillName = skillInvocation.explicitSkillName;
    if (!smokeTestSkillName) {
      throw new Error("skills tools smoke test requires an explicit skill name.");
    }
    const messageId = nanoid();
    const activateCallId = nanoid();
    const readCallId = nanoid();

    const stream = createUIMessageStream<UIMessage<RemcoChatMessageMetadata>>({
      generateId: nanoid,
      execute: async ({ writer }) => {
        const skillsTools = createSkillsTools({
          enabled: true,
          chatId: effectiveChat.id,
        });

        writer.write({
          type: "start",
          messageId,
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });

        writer.write({
          type: "tool-input-available",
          toolCallId: activateCallId,
          toolName: "skillsActivate",
          input: { name: smokeTestSkillName },
        });
        try {
          const activate = (
            skillsTools.tools as {
              skillsActivate?: { execute?: (args: { name: string }) => Promise<unknown> };
            }
          ).skillsActivate?.execute;
          if (typeof activate !== "function") {
            throw new Error("skillsActivate tool is unavailable.");
          }
          const output = await activate({ name: smokeTestSkillName });
          writer.write({
            type: "tool-output-available",
            toolCallId: activateCallId,
            output,
          });
        } catch (err) {
          writer.write({
            type: "tool-output-error",
            toolCallId: activateCallId,
            errorText: err instanceof Error ? err.message : "Failed to activate skill.",
          });
        }

        writer.write({
          type: "tool-input-available",
          toolCallId: readCallId,
          toolName: "skillsReadResource",
          input: { name: smokeTestSkillName, path: "references/REFERENCE.md" },
        });
        try {
          const readResource = (
            skillsTools.tools as {
              skillsReadResource?: {
                execute?: (args: { name: string; path: string }) => Promise<unknown>;
              };
            }
          ).skillsReadResource?.execute;
          if (typeof readResource !== "function") {
            throw new Error("skillsReadResource tool is unavailable.");
          }
          const output = await readResource({
            name: smokeTestSkillName,
            path: "references/REFERENCE.md",
          });
          writer.write({
            type: "tool-output-available",
            toolCallId: readCallId,
            output,
          });
        } catch (err) {
          writer.write({
            type: "tool-output-error",
            toolCallId: readCallId,
            errorText: err instanceof Error ? err.message : "Failed to read resource.",
          });
        }

        writer.write({
          type: "finish",
          finishReason: "stop",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      },
    });

    return createUIMessageStreamResponse({
      headers: {
        "x-remcochat-api-version": REMCOCHAT_API_VERSION,
        "x-remcochat-temporary": "0",
        "x-remcochat-profile-id": profile.id,
        "x-remcochat-chat-id": effectiveChat.id,
      },
      stream,
    });
  }

    const ovNlPolicy = computeOvNlRoutingPolicy({
      routedIntent,
      explicitSkillName: skillInvocation.explicitSkillName,
    });

  const systemParts: string[] = [
    buildSystemPrompt({
      isTemporary: false,
      chatInstructions,
      chatInstructionsRevision: effectiveChat.chatInstructionsRevision,
      profileInstructions: promptProfileInstructions,
      profileInstructionsRevision: profile.customInstructionsRevision,
      memoryEnabled: profile.memoryEnabled,
      memoryLines,
      skillsEnabled: Boolean(skillsRegistry),
      availableSkills,
      activatedSkillNames: effectiveChat.activatedSkillNames,
      toolsEnabled: resolved.capabilities.tools,
      webToolsEnabled: webTools.enabled,
      bashToolsEnabled: bashTools.enabled,
      bashToolsProvider: config.bashTools?.provider,
      bashToolsRuntime: config.bashTools?.sandbox?.runtime,
      attachmentsEnabled: config.attachments.enabled,
      ovNlToolsEnabled: ovNlTools.enabled,
      ovNlToolAllowed: ovNlPolicy.toolAllowedForPrompt,
      ovNlToolConfidence: ovNlPolicy.routerConfidence ?? undefined,
    }),
  ];

  if (skillInvocation.explicitSkillName) {
    systemParts.push(
      [
        `Explicit skill invocation detected: /${skillInvocation.explicitSkillName}`,
        `Call skillsActivate first with name="${skillInvocation.explicitSkillName}".`,
      ].join("\n")
    );
  }

  if (skillInvocation.explicitSkillName && !resolved.capabilities.tools) {
    const record = skillsRegistry?.get(skillInvocation.explicitSkillName) ?? null;
    if (record) {
      const maxBytes = config.skills?.maxSkillMdBytes ?? 200_000;
      const skillMd = readFileForPrompt(record.skillMdPath, maxBytes);
      systemParts.push(
        [
          `Explicit skill invocation detected (/${record.name}). Tool calling is unavailable for this model, so the skill's SKILL.md is injected below.`,
          skillMd,
        ].join("\n\n")
      );
    }
  }

  if (isRegenerate) {
    const prior = !isTemporary && lastUserMessageId
      ? listTurnAssistantTexts({
          chatId: effectiveChat.id,
          turnUserMessageId: lastUserMessageId,
          limit: 6,
        })
      : [];

    systemParts.push(
      [
        "Regeneration: produce an alternative assistant response for the latest user message.",
        prior.length > 0
          ? "Do NOT repeat any of these previous answers (verbatim or near-verbatim):\n" +
            prior
              .map((t, i) => {
                const oneLine = t.replace(/\s+/g, " ").trim();
                const clipped = oneLine.length > 240 ? `${oneLine.slice(0, 240)}…` : oneLine;
                return `  ${i + 1}. ${clipped}`;
              })
              .join("\n")
          : "Avoid repeating your previous assistant message verbatim.",
        "If higher-priority instructions constrain output, obey them even during regeneration.",
      ].join(" ")
    );
  }

  const system = systemParts.join("\n\n");

  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  try {
    const withAttachments = await replaceAttachmentPartsWithExtractedText({
      profileId: profile.id,
      messages: skillInvocation.messages,
    });
    modelMessages = await convertToModelMessages(withAttachments, {
      ignoreIncompleteToolCalls: true,
    });
  } catch (err) {
    return uiTextResponse({
      headers: { "x-remcochat-api-version": REMCOCHAT_API_VERSION },
      text:
        err instanceof Error
          ? `Attachment processing error: ${err.message}`
          : "Attachment processing error.",
      messageMetadata: {
        createdAt: now,
        turnUserMessageId: lastUserMessageId || undefined,
        profileInstructionsRevision: currentProfileRevision,
        chatInstructionsRevision: currentChatRevision,
      },
    });
  }

  const chatTools = createTools({
    chatId: effectiveChat.id,
    profileId: profile.id,
    isTemporary: false,
    memoryEnabled: profile.memoryEnabled,
    viewerTimeZone,
    toolContext: { lastUserText, previousUserText },
    model: resolved.capabilities.tools ? resolved.model : undefined,
    supportsTemperature: resolved.capabilities.temperature,
  });
  const skillsTools = createSkillsTools({
    enabled: Boolean(skillsRegistry),
    chatId: effectiveChat.id,
  });
  const hueSkillRelevant =
    skillInvocation.explicitSkillName === "hue-instant-control" ||
    effectiveChat.activatedSkillNames.includes("hue-instant-control");
  const hueGatewayTools = createHueGatewayTools({
    request: req,
    isTemporary: false,
    skillRelevant: hueSkillRelevant,
    chatId: effectiveChat.id,
    turnUserMessageId: lastUserMessageId || "",
  });
  const maxSteps = bashTools.enabled ? 20 : webTools.enabled ? 12 : 5;
  const providerOptions = createProviderOptionsForWebTools({
    modelType: resolved.modelType,
    providerModelId: resolved.providerModelId,
    webToolsEnabled: webTools.enabled,
    capabilities: resolved.capabilities,
    reasoning: reasoningSelection.effectiveReasoning,
  });
  const forceMemoryAnswerTool = shouldForceMemoryAnswerTool(
    lastUserText,
    memoryLines
  );
  const explicitBashCommand = bashTools.enabled
    ? extractExplicitBashCommand(lastUserText)
    : null;
  const forceOvNlGatewayTool = ovNlPolicy.forceFastPath;
  const ovGatewayExecute = (
    ovNlTools.tools as {
      ovNlGateway?: { execute?: (input: unknown) => Promise<unknown> };
    }
  ).ovNlGateway?.execute;
  const ovFastPath = await tryOvIntentFastPath({
    enabled: ovNlTools.enabled,
    shouldTry: !forceMemoryAnswerTool && !explicitBashCommand && forceOvNlGatewayTool,
    explicitSkillActivationOnly: isExplicitSkillActivationOnlyPrompt({
      messages: skillInvocation.messages,
      explicitSkillName: skillInvocation.explicitSkillName,
    }),
    executeOvGateway: typeof ovGatewayExecute === "function" ? ovGatewayExecute : null,
    text: lastUserTextFromMessages(skillInvocation.messages),
    previousUserText,
    messages: skillInvocation.messages,
    messageMetadata: {
      createdAt: now,
      turnUserMessageId: lastUserMessageId || undefined,
      profileInstructionsRevision: currentProfileRevision,
      chatInstructionsRevision: currentChatRevision,
    },
    headers: {
      "x-remcochat-api-version": REMCOCHAT_API_VERSION,
      "x-remcochat-temporary": "0",
      "x-remcochat-profile-id": profile.id,
      "x-remcochat-chat-id": effectiveChat.id,
    },
  });
  if (ovFastPath) return ovFastPath;

	  const forcedToolChoice = forceMemoryAnswerTool
	    ? ({ type: "tool", toolName: "displayMemoryAnswer" } as const)
	    : explicitBashCommand
	      ? ({ type: "tool", toolName: "bash" } as const)
	      : null;
	  const result = streamText({
    model: resolved!.model,
    system,
    messages: modelMessages,
    ...(resolved!.capabilities.temperature && !resolved!.capabilities.reasoning
      ? { temperature: isRegenerate ? 0.9 : 0 }
      : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(resolved!.capabilities.tools
      ? {
          ...(forcedToolChoice ? { toolChoice: forcedToolChoice } : {}),
	          stopWhen: [
	            hasToolCall("displayWeather"),
	            hasToolCall("displayWeatherForecast"),
	            ...(stopAfterCurrentDateTime
	              ? [hasToolCall("displayCurrentDateTime")]
	              : []),
	            ...(stopAfterTimezones ? [hasToolCall("displayTimezones")] : []),
	            hasToolCall("displayNotes"),
	            hasToolCall("displayMemoryPrompt"),
	            hasToolCall("displayMemoryAnswer"),
	            hasToolCall("displayList"),
	            hasToolCall("displayListsOverview"),
	            hasToolCall("displayAgenda"),
	            stepCountIs(maxSteps),
	          ],
	          tools: {
	            ...chatTools,
	            ...webTools.tools,
	            ...bashTools.tools,
	            ...skillsTools.tools,
	            ...hueGatewayTools.tools,
              ...ovNlTools.tools,
	          } as StreamTextToolSet,
	        }
	      : { stopWhen: [stepCountIs(5)] }),
	  });

	  const headers = {
	    "x-remcochat-api-version": REMCOCHAT_API_VERSION,
	    "x-remcochat-temporary": "0",
	    "x-remcochat-profile-id": profile.id,
      "x-remcochat-chat-id": effectiveChat.id,
      "x-remcochat-provider-id": resolved.providerId,
      "x-remcochat-model-type": resolved.modelType,
      "x-remcochat-provider-model-id": resolved.providerModelId,
      "x-remcochat-model-id": resolved.modelId,
      "x-remcochat-reasoning-enabled":
        config.reasoning.enabled && resolved.capabilities.reasoning ? "1" : "0",
    "x-remcochat-reasoning-effort":
      config.reasoning.enabled && resolved.capabilities.reasoning
        ? reasoningSelection.effectiveEffort
        : "",
    "x-remcochat-reasoning-effort-requested": reasoningSelection.requestedEffort,
    "x-remcochat-reasoning-effort-effective":
      config.reasoning.enabled && resolved.capabilities.reasoning
        ? reasoningSelection.effectiveEffort
        : "",
    "x-remcochat-reasoning-exposed": config.reasoning.exposeToClient ? "1" : "0",
      "x-remcochat-profile-instructions-rev": String(
        profile.customInstructionsRevision
      ),
      "x-remcochat-chat-instructions-rev": String(
        effectiveChat.chatInstructionsRevision
      ),
      "x-remcochat-profile-instructions-len": String(profileInstructions.length),
      "x-remcochat-profile-instructions-hash": hash8(profileInstructions),
      "x-remcochat-chat-instructions-len": String(chatInstructions.length),
      "x-remcochat-chat-instructions-hash": hash8(chatInstructions),
      "x-remcochat-profile-instructions-stored-len": String(
        storedProfileInstructions.length
      ),
      "x-remcochat-profile-instructions-stored-hash": hash8(
        storedProfileInstructions
      ),
	    "x-remcochat-web-tools-enabled": webTools.enabled ? "1" : "0",
	    "x-remcochat-web-tools": Object.keys(webTools.tools).join(","),
	    "x-remcochat-bash-tools-enabled": bashTools.enabled ? "1" : "0",
	    "x-remcochat-bash-tools": Object.keys(bashTools.tools).join(","),
      "x-remcochat-ov-nl-tools-enabled": ovNlTools.enabled ? "1" : "0",
      "x-remcochat-ov-nl-tools": Object.keys(ovNlTools.tools).join(","),
	  };

  const baseMessageMetadata = {
    createdAt: now,
    turnUserMessageId: lastUserMessageId || undefined,
    profileInstructionsRevision: currentProfileRevision,
    chatInstructionsRevision: currentChatRevision,
  };

  const messageMetadata = ({
    part,
  }: {
    part: TextStreamPart<StreamTextToolSet>;
  }) => {
    if (part.type === "start") return baseMessageMetadata;
    if (part.type === "finish") {
      return {
        ...baseMessageMetadata,
        usage: part.totalUsage,
      };
    }
    return undefined;
  };

  const shouldAutoContinuePerplexity =
    webTools.enabled &&
    Object.prototype.hasOwnProperty.call(webTools.tools, "perplexity_search");

  const baseUIStream = result.toUIMessageStream({
    generateMessageId: nanoid,
    messageMetadata,
    sendReasoning: config.reasoning.exposeToClient,
  });

	  const shouldInspectForContinuation = shouldAutoContinuePerplexity;
  if (!shouldInspectForContinuation) {
    return createUIMessageStreamResponse({
      headers,
      stream: createUIMessageStreamWithToolErrorContinuation({
        stream: baseUIStream,
        shouldContinue: () => false,
        createContinuationStream: async () => null,
      }),
    });
  }

  return createUIMessageStreamResponse({
    headers,
	    stream: createUIMessageStreamWithDeferredContinuation({
	      stream: baseUIStream,
	      collect: (inspectionStream) =>
	        collectUIMessageChunks(inspectionStream, {
	          isWebToolName,
	          captureChunks: false,
	        }),
	      createContinuationStream: async (collected) => {
	        const perplexityOutput = collected.webToolOutputs.get("perplexity_search");
	        const needsPerplexityContinuation =
	          collected.finishReason === "tool-calls" &&
	          !collected.hasUserVisibleOutput &&
	          perplexityOutput != null;

	        if (!needsPerplexityContinuation) {
	          if (collected.toolErrors.length === 0) return null;

          const continuationMessages = modelMessages.concat([
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: formatToolErrorsForPrompt(collected.toolErrors),
                },
              ],
            },
          ]);

          const continued = streamText({
            model: resolved!.model,
            system,
            messages: continuationMessages,
            toolChoice: "none",
		            tools: {
		              ...chatTools,
		              ...webTools.tools,
		              ...bashTools.tools,
		              ...skillsTools.tools,
		              ...hueGatewayTools.tools,
                  ...ovNlTools.tools,
		            } as StreamTextToolSet,
            ...(resolved!.capabilities.temperature && !resolved!.capabilities.reasoning
              ? { temperature: isRegenerate ? 0.9 : 0 }
              : {}),
            ...(providerOptions ? { providerOptions } : {}),
            stopWhen: [stepCountIs(5)],
          });

          const continuedStream = continued.toUIMessageStream({
            generateMessageId: nanoid,
            messageMetadata,
            sendReasoning: config.reasoning.exposeToClient,
          });
          const safeContinuedStream = createUIMessageStreamWithToolErrorContinuation({
            stream: continuedStream,
            shouldContinue: () => false,
            createContinuationStream: async () => null,
          });
          return stripUIMessageStream(safeContinuedStream, { dropStart: true });
        }

        const formatted = formatPerplexitySearchResultsForPrompt(perplexityOutput, {
          maxResults: 5,
          maxSnippetChars: 420,
        });

        if (!formatted.ok) {
          return uiTextContinuationStream({
            text: `Web search error: ${formatted.errorText}`,
            messageMetadata: baseMessageMetadata,
          });
        }

        const continuationText = [
          "Web search results (from perplexity_search). Use these to answer the user's last message. Include source URLs where relevant.",
          lastUserText ? `User question: ${lastUserText}` : "",
          formatted.text,
        ]
          .filter(Boolean)
          .join("\n\n");

        const continuationMessages = modelMessages.concat([
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: continuationText }],
          },
        ]);

	        const tools = {
	          ...chatTools,
	          ...webTools.tools,
	          ...bashTools.tools,
            ...skillsTools.tools,
            ...hueGatewayTools.tools,
            ...ovNlTools.tools,
	        } as StreamTextToolSet;
	        delete tools.perplexity_search;

        const continued = streamText({
          model: resolved!.model,
          system,
          messages: continuationMessages,
          ...(resolved!.capabilities.temperature && !resolved!.capabilities.reasoning
            ? { temperature: isRegenerate ? 0.9 : 0 }
            : {}),
          ...(providerOptions ? { providerOptions } : {}),
          ...(resolved!.capabilities.tools
            ? {
                ...(forcedToolChoice ? { toolChoice: forcedToolChoice } : {}),
                stopWhen: [
                  hasToolCall("displayWeather"),
                  hasToolCall("displayWeatherForecast"),
                  ...(stopAfterCurrentDateTime
                    ? [hasToolCall("displayCurrentDateTime")]
                    : []),
                  ...(stopAfterTimezones ? [hasToolCall("displayTimezones")] : []),
                  hasToolCall("displayNotes"),
                  hasToolCall("displayMemoryAnswer"),
                  hasToolCall("displayList"),
                  hasToolCall("displayListsOverview"),
                  hasToolCall("displayAgenda"),
                  hasToolCall("displayUrlSummary"),
                  hasToolCall("summarizeURL"),
                  stepCountIs(maxSteps),
                ],
                tools,
              }
            : { stopWhen: [stepCountIs(5)] }),
        });

        const continuedStream = continued.toUIMessageStream({
          generateMessageId: nanoid,
          messageMetadata,
          sendReasoning: config.reasoning.exposeToClient,
        });
        return stripUIMessageStream(continuedStream, { dropStart: true });
      },
    }),
  });
}
