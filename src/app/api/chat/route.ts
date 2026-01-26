import type { AgendaToolOutput, RemcoChatMessageMetadata } from "@/lib/types";
import { getChat, listTurnAssistantTexts, updateChat } from "@/server/chats";
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
import { createTools } from "@/ai/tools";
import { createWebTools } from "@/ai/web-tools";
import { createBashTools } from "@/ai/bash-tools";
import { buildSystemPrompt } from "@/ai/system-prompt";
import { createProviderOptionsForWebTools } from "@/ai/provider-options";
import { formatPerplexitySearchResultsForPrompt } from "@/ai/perplexity";
import {
  allowedReasoningEfforts,
  normalizeReasoningEffort,
  type ReasoningEffort,
} from "@/lib/reasoning-effort";
import {
  getWeatherForLocation,
  getWeatherForecastForLocation,
} from "@/ai/weather";
import { stripWebToolPartsFromMessages } from "@/server/message-sanitize";
import { replaceAttachmentPartsWithExtractedText } from "@/server/attachment-prompt";
import { routeIntent } from "@/server/intent-router";
import { routeAgendaCommand } from "@/server/agenda-intent";
import { parseMemoryAddCommand, parseMemorizeDecision } from "@/server/memory-commands";
import { getConfig } from "@/server/config";
import { isModelAllowedForActiveProvider } from "@/server/model-registry";
import { getLanguageModelForActiveProvider } from "@/server/llm-provider";
import { runAgendaAction, type AgendaActionInput } from "@/server/agenda";

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

function shouldForceMemoryAnswerTool(userText: string, memoryLines: string[]) {
  const text = String(userText ?? "").trim().toLowerCase();
  if (!text) return false;
  if (!Array.isArray(memoryLines) || memoryLines.length === 0) return false;

  const explicitlyRequestsMemory =
    /\b(profile memory|from memory|in memory|do you remember|did i tell you|what do you remember)\b/.test(
      text
    ) || /\bmemory\b/.test(text);

  const rawTokens = text.match(/[a-z0-9]+/g) ?? [];
  const queryTokens = new Set(rawTokens.filter((token) => token.length >= 4));
  for (let i = 0; i + 1 < rawTokens.length; i += 1) {
    const a = rawTokens[i];
    const b = rawTokens[i + 1];
    if (!a || !b) continue;
    if (a.length < 3 || b.length < 3) continue;
    queryTokens.add(`${a}${b}`);
  }
  if (queryTokens.size === 0) return false;

  for (const line of memoryLines) {
    const lineRawTokens =
      String(line ?? "")
        .toLowerCase()
        .match(/[a-z0-9]+/g) ?? [];
    const lineTokens = lineRawTokens.filter((token) => token.length >= 4);
    for (const token of lineTokens) {
      if (queryTokens.has(token)) return true;
    }
    for (let i = 0; i + 1 < lineRawTokens.length; i += 1) {
      const a = lineRawTokens[i];
      const b = lineRawTokens[i + 1];
      if (!a || !b) continue;
      if (a.length < 3 || b.length < 3) continue;
      if (queryTokens.has(`${a}${b}`)) return true;
    }
  }

  return explicitlyRequestsMemory;
}

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
          forecastDays: 3,
        });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
      } catch (err) {
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText: err instanceof Error ? err.message : "Failed to fetch weather.",
        });
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
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText:
            err instanceof Error ? err.message : "Failed to fetch forecast.",
        });
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
        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText:
            err instanceof Error ? err.message : "Failed to update agenda.",
        });
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
]);

function isWebToolName(toolName: string) {
  return WEB_TOOL_NAMES.has(toolName);
}

function createBufferedUIMessageStream<T>(chunks: T[]): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

async function collectUIMessageChunks<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  const chunks: T[] = [];
  const toolNamesByCallId = new Map<string, string>();
  const webToolOutputs = new Map<string, unknown>();
  let finishReason: unknown = undefined;
  let hasUserVisibleOutput = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);

    const chunk = value as unknown;
    if (!isRecord(chunk)) continue;

    if (
      chunk?.type === "tool-input-start" ||
      chunk?.type === "tool-input-available" ||
      chunk?.type === "tool-input-error"
    ) {
      if (typeof chunk.toolCallId === "string" && typeof chunk.toolName === "string") {
        toolNamesByCallId.set(chunk.toolCallId, chunk.toolName);
      }
      continue;
    }

    if (chunk?.type === "tool-output-available" || chunk?.type === "tool-output-error") {
      const toolName =
        typeof chunk.toolCallId === "string"
          ? toolNamesByCallId.get(chunk.toolCallId)
          : undefined;

      if (toolName && isWebToolName(toolName)) {
        if (chunk.type === "tool-output-available") {
          webToolOutputs.set(toolName, chunk.output);
        } else {
          webToolOutputs.set(toolName, {
            error: "unknown",
            message: typeof chunk.errorText === "string" ? chunk.errorText : "Web tool failed.",
          });
        }
      } else {
        hasUserVisibleOutput = true;
      }
      continue;
    }

    if (
      (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta") &&
      typeof chunk.delta === "string"
    ) {
      if (chunk.delta.length > 0) hasUserVisibleOutput = true;
      continue;
    }

    if (chunk?.type === "error") {
      hasUserVisibleOutput = true;
      continue;
    }

    if (chunk?.type === "finish") {
      finishReason = chunk.finishReason;
      continue;
    }
  }

  return { chunks, webToolOutputs, finishReason, hasUserVisibleOutput };
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

  const memorizeDecision = parseMemorizeDecision(lastUserText);
  const directMemoryCandidate = parseMemoryAddCommand(lastUserText);
  const canRouteIntent = !isRegenerate && memorizeDecision == null;
  const routerContext = lastAssistantContext(body.messages);

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
        let agendaResult;
        try {
          agendaResult = await routeAgendaCommand({ text: lastUserText });
        } catch (err) {
          return uiTextResponse({
            text:
              err instanceof Error
                ? err.message
                : "Agenda intent engine is temporarily unavailable. Please try again.",
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
            },
          });
        }
        if (!agendaResult.ok) {
          return uiTextResponse({
            text: agendaResult.error,
            messageMetadata: {
              createdAt: now,
              turnUserMessageId: lastUserMessageId || undefined,
            },
          });
        }
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

    const bashTools =
      resolved.capabilities.tools && temporaryKey
        ? await createBashTools({ request: req, sessionKey: temporaryKey })
        : { enabled: false, tools: {} };

    const system = buildSystemPrompt({
      isTemporary: true,
      chatInstructions: "",
      chatInstructionsRevision: 1,
      profileInstructions,
      profileInstructionsRevision: profile.customInstructionsRevision,
      memoryEnabled: false,
      memoryLines: [],
      toolsEnabled: resolved.capabilities.tools,
      webToolsEnabled: webTools.enabled,
      bashToolsEnabled: bashTools.enabled,
      attachmentsEnabled: config.attachments.enabled,
    });

    let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
    try {
      const withAttachments = await replaceAttachmentPartsWithExtractedText({
        profileId: profile.id,
        messages: stripWebToolPartsFromMessages(body.messages),
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
      summaryModel: resolved.model,
      summarySupportsTemperature:
        resolved.capabilities.temperature && !resolved.capabilities.reasoning,
      viewerTimeZone,
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
      model: resolved.model,
      system,
      messages: modelMessages,
      ...(resolved.capabilities.temperature && !resolved.capabilities.reasoning
        ? { temperature: 0 }
        : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(resolved.capabilities.tools
        ? {
          stopWhen: [
            hasToolCall("displayWeather"),
            hasToolCall("displayWeatherForecast"),
            hasToolCall("displayTimezones"),
            hasToolCall("displayUrlSummary"),
            hasToolCall("displayNotes"),
            hasToolCall("displayMemoryPrompt"),
            hasToolCall("displayMemoryAnswer"),
            hasToolCall("displayList"),
            hasToolCall("displayListsOverview"),
            hasToolCall("displayAgenda"),
            stepCountIs(maxSteps),
          ],
          tools: { ...chatTools, ...webTools.tools, ...bashTools.tools } as StreamTextToolSet,
        }
      : { stopWhen: [stepCountIs(5)] }),
    });

    const shouldAutoContinuePerplexity =
      webTools.enabled &&
      Object.prototype.hasOwnProperty.call(webTools.tools, "perplexity_search");

    if (!shouldAutoContinuePerplexity) {
      return result.toUIMessageStreamResponse({
        headers,
        generateMessageId: nanoid,
        messageMetadata,
        sendReasoning: config.reasoning.exposeToClient,
      });
    }

    const collected = await collectUIMessageChunks(
      result.toUIMessageStream({
        generateMessageId: nanoid,
        messageMetadata,
        sendReasoning: config.reasoning.exposeToClient,
      })
    );

    const perplexityOutput = collected.webToolOutputs.get("perplexity_search");
    const needsContinuation =
      collected.finishReason === "tool-calls" &&
      !collected.hasUserVisibleOutput &&
      perplexityOutput != null;

    if (!needsContinuation) {
      return createUIMessageStreamResponse({
        headers,
        stream: createBufferedUIMessageStream(collected.chunks),
      });
    }

    const formatted = formatPerplexitySearchResultsForPrompt(perplexityOutput, {
      maxResults: 5,
      maxSnippetChars: 420,
    });

    if (!formatted.ok) {
      return uiTextResponse({
        headers,
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
      model: resolved.model,
      system,
      messages: continuationMessages,
      ...(resolved.capabilities.temperature && !resolved.capabilities.reasoning
        ? { temperature: 0 }
        : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(resolved.capabilities.tools
        ? {
            stopWhen: [
              hasToolCall("displayWeather"),
              hasToolCall("displayWeatherForecast"),
              hasToolCall("displayTimezones"),
              hasToolCall("displayUrlSummary"),
              hasToolCall("displayNotes"),
              hasToolCall("displayMemoryAnswer"),
              hasToolCall("displayList"),
              hasToolCall("displayListsOverview"),
              hasToolCall("displayAgenda"),
              stepCountIs(maxSteps),
            ],
            tools,
          }
        : { stopWhen: [stepCountIs(5)] }),
    });

    return continued.toUIMessageStreamResponse({
      headers,
      generateMessageId: nanoid,
      messageMetadata,
      sendReasoning: config.reasoning.exposeToClient,
    });
  }

  if (!body.chatId) {
    return Response.json({ error: "Missing chatId." }, { status: 400 });
  }

  const chat = getChat(body.chatId);
  if (chat.profileId !== profile.id) {
    return Response.json(
      { error: "Chat does not belong to this profile." },
      { status: 400 }
    );
  }

  if (
    typeof body.modelId === "string" &&
    isModelAllowedForActiveProvider(body.modelId) &&
    body.modelId !== chat.modelId
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
      let agendaResult;
      try {
        agendaResult = await routeAgendaCommand({ text: lastUserText });
      } catch (err) {
        return uiTextResponse({
          text:
            err instanceof Error
              ? err.message
              : "Agenda intent engine is temporarily unavailable. Please try again.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
      if (!agendaResult.ok) {
        return uiTextResponse({
          text: agendaResult.error,
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
            profileInstructionsRevision: currentProfileRevision,
            chatInstructionsRevision: currentChatRevision,
          },
        });
      }
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

  const systemParts: string[] = [
    buildSystemPrompt({
      isTemporary: false,
      chatInstructions,
      chatInstructionsRevision: effectiveChat.chatInstructionsRevision,
      profileInstructions: promptProfileInstructions,
      profileInstructionsRevision: profile.customInstructionsRevision,
      memoryEnabled: profile.memoryEnabled,
      memoryLines,
      toolsEnabled: resolved.capabilities.tools,
      webToolsEnabled: webTools.enabled,
      bashToolsEnabled: bashTools.enabled,
      attachmentsEnabled: config.attachments.enabled,
    }),
  ];

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

    const missing =
      typeof profileRev !== "number" || typeof chatRev !== "number";
    if (missing && (currentProfileRevision !== 1 || currentChatRevision !== 1)) {
      return false;
    }

    return true;
  });

  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  try {
    const withAttachments = await replaceAttachmentPartsWithExtractedText({
      profileId: profile.id,
      messages: stripWebToolPartsFromMessages(filteredMessages),
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
    summaryModel: resolved.model,
    summarySupportsTemperature:
      resolved.capabilities.temperature && !resolved.capabilities.reasoning,
    viewerTimeZone,
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
  const result = streamText({
    model: resolved.model,
    system,
    messages: modelMessages,
    ...(resolved.capabilities.temperature && !resolved.capabilities.reasoning
      ? { temperature: isRegenerate ? 0.9 : 0 }
      : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(resolved.capabilities.tools
      ? {
          ...(forceMemoryAnswerTool
            ? { toolChoice: { type: "tool", toolName: "displayMemoryAnswer" } }
            : {}),
          stopWhen: [
            hasToolCall("displayWeather"),
            hasToolCall("displayWeatherForecast"),
            hasToolCall("displayTimezones"),
            hasToolCall("displayUrlSummary"),
            hasToolCall("displayNotes"),
            hasToolCall("displayMemoryPrompt"),
            hasToolCall("displayMemoryAnswer"),
            hasToolCall("displayList"),
            hasToolCall("displayListsOverview"),
            hasToolCall("displayAgenda"),
            stepCountIs(maxSteps),
          ],
          tools: { ...chatTools, ...webTools.tools, ...bashTools.tools } as StreamTextToolSet,
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

  if (!shouldAutoContinuePerplexity) {
    return result.toUIMessageStreamResponse({
      headers,
      generateMessageId: nanoid,
      messageMetadata,
      sendReasoning: config.reasoning.exposeToClient,
    });
  }

  const collected = await collectUIMessageChunks(
    result.toUIMessageStream({
      generateMessageId: nanoid,
      messageMetadata,
      sendReasoning: config.reasoning.exposeToClient,
    })
  );

  const perplexityOutput = collected.webToolOutputs.get("perplexity_search");
  const needsContinuation =
    collected.finishReason === "tool-calls" &&
    !collected.hasUserVisibleOutput &&
    perplexityOutput != null;

  if (!needsContinuation) {
    return createUIMessageStreamResponse({
      headers,
      stream: createBufferedUIMessageStream(collected.chunks),
    });
  }

  const formatted = formatPerplexitySearchResultsForPrompt(perplexityOutput, {
    maxResults: 5,
    maxSnippetChars: 420,
  });

  if (!formatted.ok) {
    return uiTextResponse({
      headers,
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
    model: resolved.model,
    system,
    messages: continuationMessages,
    ...(resolved.capabilities.temperature && !resolved.capabilities.reasoning
      ? { temperature: isRegenerate ? 0.9 : 0 }
      : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(resolved.capabilities.tools
      ? {
          stopWhen: [
            hasToolCall("displayWeather"),
            hasToolCall("displayWeatherForecast"),
            hasToolCall("displayTimezones"),
            hasToolCall("displayUrlSummary"),
            hasToolCall("displayNotes"),
            hasToolCall("displayMemoryAnswer"),
            hasToolCall("displayList"),
            hasToolCall("displayListsOverview"),
            hasToolCall("displayAgenda"),
            stepCountIs(maxSteps),
          ],
          tools,
        }
      : { stopWhen: [stepCountIs(5)] }),
  });

  return continued.toUIMessageStreamResponse({
    headers,
    generateMessageId: nanoid,
    messageMetadata,
    sendReasoning: config.reasoning.exposeToClient,
  });
}
