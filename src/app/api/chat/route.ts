import type { RemcoChatMessageMetadata } from "@/lib/types";
import { getChat, listTurnAssistantTexts, updateChat } from "@/server/chats";
import { getProfile } from "@/server/profiles";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  hasToolCall,
  stepCountIs,
  streamText,
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
import { buildSystemPrompt } from "@/ai/system-prompt";
import { createProviderOptionsForWebTools } from "@/ai/provider-options";
import { formatPerplexitySearchResultsForPrompt } from "@/ai/perplexity";
import {
  getWeatherForLocation,
  getWeatherForecastForLocation,
} from "@/ai/weather";
import { stripWebToolPartsFromMessages } from "@/server/message-sanitize";
import { routeIntent } from "@/server/intent-router";
import { isModelAllowedForActiveProvider } from "@/server/model-registry";
import { getLanguageModelForActiveProvider } from "@/server/llm-provider";

export const maxDuration = 30;

const REMCOCHAT_API_VERSION = "instruction-frame-v1";

type ChatRequestBody = {
  messages: UIMessage<RemcoChatMessageMetadata>[];
  modelId?: string;
  profileId?: string;
  chatId?: string;
  temporary?: boolean;
  regenerate?: boolean;
  regenerateMessageId?: string;
};

function messageText(message: UIMessage<RemcoChatMessageMetadata>) {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

function parseMemorizeIntent(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const patterns = [
    /^(?:please\s+)?memorize(?:\s+(?:this|that))?\s*[,.:]?\s*(.*)$/i,
    /^(?:please\s+)?remember(?:\s+(?:this|that))?\s*[,.:]?\s*(.*)$/i,
    /^(?:please\s+)?save(?:\s+(?:this|that))?(?:\s+for\s+later)?\s*[,.:]?\s*(.*)$/i,
    /^(?:please\s+)?store(?:\s+(?:this|that))?\s*[,.:]?\s*(.*)$/i,
    /^(?:please\s+)?keep(?:\s+(?:this|that))?\s+in\s+mind\s*[,.:]?\s*(.*)$/i,
    /^(?:please\s+)?add(?:\s+(?:this|that))?\s+(?:to|into)\s+(?:memory|profile memory|chat memory)\s*[,.:]?\s*(.*)$/i,
    /^(?:please\s+)?put(?:\s+(?:this|that))?\s+(?:in|into)\s+(?:memory|profile memory|chat memory)\s*[,.:]?\s*(.*)$/i,
    /^(?:please\s+)?save(?:\s+(?:this|that))?\s+(?:to|into)\s+(?:memory|profile memory|chat memory)\s*[,.:]?\s*(.*)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    return (match[1] ?? "").trim();
  }

  return null;
}

function isNotesIntent(text: string) {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return false;
  const patterns = [
    /\bnote this\b/,
    /\bmake a note\b/,
    /\bmake note\b/,
    /\bquick note\b/,
    /\bnote to self\b/,
    /\bjot (this|that) down\b/,
    /\bjot down\b/,
    /\bsave (this|that) as a note\b/,
    /\bsave as a note\b/,
    /\badd (this|that) to notes\b/,
    /\badd to notes\b/,
    /\bshow notes\b/,
    /\bshow my notes\b/,
    /\bnoteer\b/,
    /\bnotitie\b/,
    /\bnotities\b/,
    /\bschrijf dit op\b/,
    /\bopschrijven\b/,
    /\bnote this:\b/,
  ];
  return patterns.some((pattern) => pattern.test(trimmed));
}

function parseMemorizeDecision(text: string) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,]/g, "")
    .replace(/['"]/g, "")
    .replace(/\s+/g, " ");
  if (!normalized) return null;

  const confirm = new Set([
    "confirm",
    "confirm memory",
    "confirm memorize",
    "confirm memorization",
    "confirm save",
    "confirm it",
    "yes",
    "yes please",
    "ok",
    "okay",
    "sure",
    "save it",
    "save this",
    "please save",
  ]);

  const cancel = new Set([
    "cancel",
    "cancel memory",
    "cancel memorize",
    "cancel memorization",
    "cancel save",
    "cancel it",
    "no",
    "no thanks",
    "dont save",
    "do not save",
    "nope",
    "stop",
    "skip",
  ]);

  if (confirm.has(normalized)) return "confirm";
  if (cancel.has(normalized)) return "cancel";
  if (normalized.startsWith("confirm ")) return "confirm";
  if (normalized.startsWith("cancel ")) return "cancel";
  return null;
}

function needsMemoryContext(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (/\s/.test(trimmed)) return false;
  const stripped = trimmed.replace(/[.!?,;:]+$/g, "");
  if (!stripped) return true;
  return /^[A-Za-z][A-Za-z'-]*$/.test(stripped);
}

function shouldRouteIntent(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (isNotesIntent(lower)) return false;
  const hasQuestion = trimmed.includes("?");
  const hasMemoryHint =
    /\b(remember|save|store|memorize|keep in mind|add to memory|put in memory)\b/.test(
      lower
    );
  const hasWeatherHint =
    /\b(weather|forecast|temperature|rain|snow|wind|humidity|degrees|°)\b/.test(
      lower
    );
  return hasMemoryHint || hasWeatherHint;
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

function hash8(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
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

function createBufferedUIMessageStream(chunks: unknown[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk as any);
      controller.close();
    },
  });
}

async function collectUIMessageChunks(stream: ReadableStream<any>) {
  const reader = stream.getReader();
  const chunks: any[] = [];
  const toolNamesByCallId = new Map<string, string>();
  const webToolOutputs = new Map<string, unknown>();
  let finishReason: unknown = undefined;
  let hasUserVisibleOutput = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = value as any;
    chunks.push(chunk);

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

    if (chunk?.type === "text-delta" && typeof chunk.delta === "string") {
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

  const notesIntent = isNotesIntent(lastUserText);
  const memorizeContent = notesIntent ? null : parseMemorizeIntent(lastUserText);
  const memorizeDecision = parseMemorizeDecision(lastUserText);
  const canRouteIntent =
    !isRegenerate &&
    shouldRouteIntent(lastUserText) &&
    memorizeContent == null &&
    memorizeDecision == null;

  if (isTemporary) {
    const candidateModelId =
      typeof body.modelId === "string" ? body.modelId : profile.defaultModelId;
    let resolved:
      | ReturnType<typeof getLanguageModelForActiveProvider>
      | undefined;
    const resolveModel = (): ReturnType<
      typeof getLanguageModelForActiveProvider
    > => {
      if (!resolved) {
        resolved = getLanguageModelForActiveProvider(candidateModelId);
      }
      return resolved;
    };

    if (memorizeContent != null) {
      return uiTextResponse({
        text: "Temporary chats do not save memory. Turn off Temp, then ask me to remember something and confirm when asked.",
        messageMetadata: {
          createdAt: now,
          turnUserMessageId: lastUserMessageId || undefined,
        },
      });
    }

    if (canRouteIntent) {
      let routed;
      try {
        routed = await routeIntent({ text: lastUserText });
      } catch (err) {
        return Response.json(
          {
            error:
              err instanceof Error
                ? `Intent router failed: ${err.message}`
                : "Intent router failed.",
          },
          { status: 500 }
        );
      }

      if (routed?.intent === "memory_add") {
        return uiTextResponse({
          text: "Temporary chats do not save memory. Turn off Temp, then ask me to remember something and confirm when asked.",
          messageMetadata: {
            createdAt: now,
            turnUserMessageId: lastUserMessageId || undefined,
          },
        });
      }
      if (routed?.intent === "weather_current") {
        let resolvedForTools;
        try {
          resolvedForTools = resolveModel();
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
      if (routed?.intent === "weather_forecast") {
        let resolvedForTools;
        try {
          resolvedForTools = resolveModel();
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
    }

    try {
      resolved = resolveModel();
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to load model." },
        { status: 500 }
      );
    }

    const profileInstructions = (profile.customInstructions ?? "").trim();

    const webTools = resolved.capabilities.tools
      ? createWebTools({
          providerId: resolved.providerId,
          modelType: resolved.modelType,
          providerModelId: resolved.providerModelId,
        })
      : { enabled: false, tools: {} };

    const system = buildSystemPrompt({
      isTemporary: true,
      chatInstructions: "",
      chatInstructionsRevision: 1,
      profileInstructions,
      profileInstructionsRevision: profile.customInstructionsRevision,
      memoryLines: [],
      toolsEnabled: resolved.capabilities.tools,
      webToolsEnabled: webTools.enabled,
    });

    const modelMessages = await convertToModelMessages(
      stripWebToolPartsFromMessages(body.messages),
      { ignoreIncompleteToolCalls: true }
    );

    const chatTools = createTools({
      profileId: profile.id,
      summaryModel: resolved.model,
      summarySupportsTemperature: resolved.capabilities.temperature,
    });
    const maxSteps = webTools.enabled ? 12 : 5;
    const providerOptions = createProviderOptionsForWebTools({
      modelType: resolved.modelType,
      providerModelId: resolved.providerModelId,
      webToolsEnabled: webTools.enabled,
    });

    const headers = {
      "x-remcochat-api-version": REMCOCHAT_API_VERSION,
      "x-remcochat-temporary": "1",
      "x-remcochat-profile-id": profile.id,
      "x-remcochat-provider-id": resolved.providerId,
      "x-remcochat-model-type": resolved.modelType,
      "x-remcochat-provider-model-id": resolved.providerModelId,
      "x-remcochat-model-id": resolved.modelId,
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
    };

    const messageMetadata = () => ({
      createdAt: now,
      turnUserMessageId: lastUserMessageId || undefined,
      profileInstructionsRevision: profile.customInstructionsRevision,
      chatInstructionsRevision: 0,
    });

    const result = streamText({
      model: resolved.model,
      system,
      messages: modelMessages,
      ...(resolved.capabilities.temperature ? { temperature: 0 } : {}),
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
              stepCountIs(maxSteps),
            ],
            tools: { ...chatTools, ...webTools.tools },
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
      });
    }

    const collected = await collectUIMessageChunks(
      result.toUIMessageStream({
        generateMessageId: nanoid,
        messageMetadata,
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
        messageMetadata: messageMetadata(),
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

    const tools = { ...chatTools, ...webTools.tools } as Record<string, any>;
    delete tools.perplexity_search;

    const continued = streamText({
      model: resolved.model,
      system,
      messages: continuationMessages,
      ...(resolved.capabilities.temperature ? { temperature: 0 } : {}),
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
    | ReturnType<typeof getLanguageModelForActiveProvider>
    | undefined;
  const resolveModel = (): ReturnType<
    typeof getLanguageModelForActiveProvider
  > => {
    if (!resolved) {
      resolved = getLanguageModelForActiveProvider(effectiveChat.modelId);
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

  if (memorizeContent != null) {
    if (!memorizeContent) {
      return uiTextResponse({
        text:
          'To memorize something, start your message with something like "Remember this: <thing to remember>". I will ask you to confirm before saving.',
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

    if (needsMemoryContext(memorizeContent)) {
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
        content: memorizeContent,
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

  if (canRouteIntent) {
    let routed;
    try {
      routed = await routeIntent({ text: lastUserText });
    } catch (err) {
      return Response.json(
        {
          error:
            err instanceof Error
              ? `Intent router failed: ${err.message}`
              : "Intent router failed.",
        },
        { status: 500 }
      );
    }

      if (routed?.intent === "memory_add") {
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

    if (routed?.intent === "weather_current") {
      let resolvedForTools;
      try {
        resolvedForTools = resolveModel();
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

    if (routed?.intent === "weather_forecast") {
      let resolvedForTools;
      try {
        resolvedForTools = resolveModel();
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
    resolved = resolveModel();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load model." },
      { status: 500 }
    );
  }

  const webTools = resolved.capabilities.tools
    ? createWebTools({
        providerId: resolved.providerId,
        modelType: resolved.modelType,
        providerModelId: resolved.providerModelId,
      })
    : { enabled: false, tools: {} };

  const systemParts: string[] = [
    buildSystemPrompt({
      isTemporary: false,
      chatInstructions,
      chatInstructionsRevision: effectiveChat.chatInstructionsRevision,
      profileInstructions: promptProfileInstructions,
      profileInstructionsRevision: profile.customInstructionsRevision,
      memoryLines,
      toolsEnabled: resolved.capabilities.tools,
      webToolsEnabled: webTools.enabled,
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

  const modelMessages = await convertToModelMessages(
    stripWebToolPartsFromMessages(filteredMessages),
    { ignoreIncompleteToolCalls: true }
  );

  const chatTools = createTools({
    profileId: profile.id,
    summaryModel: resolved.model,
    summarySupportsTemperature: resolved.capabilities.temperature,
  });
  const maxSteps = webTools.enabled ? 12 : 5;
  const providerOptions = createProviderOptionsForWebTools({
    modelType: resolved.modelType,
    providerModelId: resolved.providerModelId,
    webToolsEnabled: webTools.enabled,
  });
  const result = streamText({
    model: resolved.model,
    system,
    messages: modelMessages,
    ...(resolved.capabilities.temperature
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
            stepCountIs(maxSteps),
          ],
          tools: { ...chatTools, ...webTools.tools },
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
    };

  const messageMetadata = () => ({
    createdAt: now,
    turnUserMessageId: lastUserMessageId || undefined,
    profileInstructionsRevision: currentProfileRevision,
    chatInstructionsRevision: currentChatRevision,
  });

  const shouldAutoContinuePerplexity =
    webTools.enabled &&
    Object.prototype.hasOwnProperty.call(webTools.tools, "perplexity_search");

  if (!shouldAutoContinuePerplexity) {
    return result.toUIMessageStreamResponse({
      headers,
      generateMessageId: nanoid,
      messageMetadata,
    });
  }

  const collected = await collectUIMessageChunks(
    result.toUIMessageStream({
      generateMessageId: nanoid,
      messageMetadata,
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
      messageMetadata: messageMetadata(),
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

  const tools = { ...chatTools, ...webTools.tools } as Record<string, any>;
  delete tools.perplexity_search;

  const continued = streamText({
    model: resolved.model,
    system,
    messages: continuationMessages,
    ...(resolved.capabilities.temperature
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
  });
}
