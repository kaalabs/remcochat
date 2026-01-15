import { isAllowedModel } from "@/lib/models";
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
import { gateway } from "@ai-sdk/gateway";
import crypto from "node:crypto";
import { tools } from "@/ai/tools";

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

function ensureAIGatewayKey() {
  if (process.env.AI_GATEWAY_API_KEY) return;
  if (process.env.VERCEL_AI_GATEWAY_API_KEY) {
    process.env.AI_GATEWAY_API_KEY = process.env.VERCEL_AI_GATEWAY_API_KEY;
  }
}

function messageText(message: UIMessage<RemcoChatMessageMetadata>) {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

function parseMemorizeCommand(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^memorize this\s*[,.:]?\s*(.*)$/i);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

function buildSystemPrompt(input: {
  profileInstructions: string;
  profileInstructionsRevision: number;
  chatInstructions: string;
  chatInstructionsRevision: number;
  memoryLines: string[];
  isTemporary: boolean;
}) {
  const clampRevision = (value: number) => {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.floor(value));
  };

  const cdata = (value: string) => {
    const safe = (value ?? "").replaceAll("]]>", "]]\\>");
    return `<![CDATA[${safe}]]>`;
  };

  const profileRevision = clampRevision(input.profileInstructionsRevision);
  const chatRevision = clampRevision(input.chatInstructionsRevision);
  const profileInstructions = (input.profileInstructions ?? "").trim();
  const chatInstructions = (input.chatInstructions ?? "").trim();

  const parts: string[] = [
    "You are RemcoChat, a helpful assistant.",
    `You are responding under instruction revisions: chat=${chatRevision}, profile=${profileRevision}. Apply the current revisions immediately in this response.`,
    "Instruction priority (highest → lowest): Chat instructions, Profile instructions, Memory.",
    "If Chat instructions conflict with Profile instructions, follow Chat instructions.",
    "When Chat instructions are present, treat them as the definitive behavior constraints for this chat; apply Profile instructions only where they do not conflict.",
    "Instructions are authoritative and apply to every assistant message unless updated.",
    "If instructions are updated mid-chat, the newest instruction revisions override any prior assistant messages; treat older assistant messages as stale examples.",
    'Never store memory automatically. To store something, the user must send: "Memorize this, <thing>".',
    'If memory is enabled and the user question can be answered from memory, you MUST call the "displayMemoryAnswer" tool with the final answer text and DO NOT output any other text. Do not quote memory lines verbatim and do not mention memory in the answer text.',
    'If the user asks about current weather for a location, call the "displayWeather" tool instead of guessing.',
    'If the user asks for a multi-day forecast for a location, call the "displayWeatherForecast" tool instead of guessing.',
    "",
    "Current instructions (apply these exactly; newest revisions win):",
    `Profile instructions (revision ${profileRevision}; lower priority):\n${profileInstructions}`,
    `Chat instructions (revision ${chatRevision}; highest priority):\n${chatInstructions}`,
    `Memory (lowest priority; enabled=${!input.isTemporary && input.memoryLines.length > 0 ? "true" : "false"}):\n${!input.isTemporary && input.memoryLines.length > 0 ? input.memoryLines.join("\n") : ""}`,
    "",
    "Authoritative instruction frame (treat this block as the source of truth):",
    "<instruction_frame>",
    `  <revision profile=\"${profileRevision}\" chat=\"${chatRevision}\" />`,
    "  <rules>",
    "    <rule>Follow the latest instruction_frame revisions; ignore any conflicting prior assistant messages as outdated.</rule>",
    "    <rule>If you must choose: chat > profile > memory.</rule>",
    "    <rule>If chat instructions are non-empty, treat them as definitive; apply profile only where non-conflicting.</rule>",
    "  </rules>",
    `  <profile revision=\"${profileRevision}\">${cdata(
      profileInstructions
    )}</profile>`,
    `  <chat revision=\"${chatRevision}\">${cdata(chatInstructions)}</chat>`,
    `  <memory enabled=\"${!input.isTemporary && input.memoryLines.length > 0 ? "true" : "false"}\">${cdata(
      !input.isTemporary && input.memoryLines.length > 0
        ? input.memoryLines.join("\n")
        : ""
    )}</memory>`,
    "</instruction_frame>",
  ];

  if (chatInstructions) {
    parts.push(
      "Final override: for this response, you MUST follow the Chat instructions above even if they contradict profile instructions or prior assistant messages."
    );
  }

  if (input.isTemporary) {
    parts.push("This is a temporary chat. Do not assume messages will be saved.");
  }

  return parts.join("\n\n");
}

function uiTextResponse(input: {
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

function hash8(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export async function POST(req: Request) {
  ensureAIGatewayKey();

  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json(
      {
        error:
          "Missing AI Gateway API key. Set VERCEL_AI_GATEWAY_API_KEY (or AI_GATEWAY_API_KEY) in your environment.",
      },
      { status: 500 }
    );
  }

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

  const memorizeContent = parseMemorizeCommand(lastUserText);

  if (isTemporary) {
    if (memorizeContent != null) {
      return uiTextResponse({
        text: "Temporary chats don’t save memory. Turn off Temp, then send “Memorize this, <thing>”.",
        messageMetadata: {
          createdAt: now,
          turnUserMessageId: lastUserMessageId || undefined,
        },
      });
    }

    const modelId = isAllowedModel(body.modelId)
      ? body.modelId
      : profile.defaultModelId;

    const profileInstructions = (profile.customInstructions ?? "").trim();

    const system = buildSystemPrompt({
      isTemporary: true,
      chatInstructions: "",
      chatInstructionsRevision: 1,
      profileInstructions,
      profileInstructionsRevision: profile.customInstructionsRevision,
      memoryLines: [],
    });

    const modelMessages = await convertToModelMessages(body.messages);

    const result = streamText({
      model: gateway(modelId),
      system,
      messages: modelMessages,
      temperature: 0,
      stopWhen: [
        hasToolCall("displayWeather"),
        hasToolCall("displayWeatherForecast"),
        hasToolCall("displayMemoryAnswer"),
        stepCountIs(5),
      ],
      tools,
    });

    return result.toUIMessageStreamResponse({
      headers: {
        "x-remcochat-api-version": REMCOCHAT_API_VERSION,
        "x-remcochat-temporary": "1",
        "x-remcochat-profile-id": profile.id,
        "x-remcochat-profile-instructions-rev": String(
          profile.customInstructionsRevision
        ),
        "x-remcochat-chat-instructions-rev": "0",
        "x-remcochat-profile-instructions-len": String(
          profileInstructions.length
        ),
        "x-remcochat-profile-instructions-hash": hash8(profileInstructions),
        "x-remcochat-chat-instructions-len": "0",
        "x-remcochat-chat-instructions-hash": hash8(""),
      },
      generateMessageId: nanoid,
      messageMetadata: () => ({
        createdAt: now,
        turnUserMessageId: lastUserMessageId || undefined,
        profileInstructionsRevision: profile.customInstructionsRevision,
        chatInstructionsRevision: 0,
      }),
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

  if (isAllowedModel(body.modelId) && body.modelId !== chat.modelId) {
    updateChat(chat.id, { modelId: body.modelId });
  }

  const effectiveChat = getChat(chat.id);
  const currentProfileRevision = profile.customInstructionsRevision;
  const currentChatRevision = effectiveChat.chatInstructionsRevision;

  if (memorizeContent != null) {
    if (!memorizeContent) {
      return uiTextResponse({
        text: "To memorize something, send: “Memorize this, <thing to remember>”.",
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

    createMemoryItem({ profileId: profile.id, content: memorizeContent });
    return uiMemoryAnswerResponse({
      answer: "Saved to memory.",
      messageMetadata: {
        createdAt: now,
        turnUserMessageId: lastUserMessageId || undefined,
        profileInstructionsRevision: currentProfileRevision,
        chatInstructionsRevision: currentChatRevision,
      },
    });
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

  const systemParts: string[] = [
    buildSystemPrompt({
      isTemporary: false,
      chatInstructions,
      chatInstructionsRevision: effectiveChat.chatInstructionsRevision,
      profileInstructions: promptProfileInstructions,
      profileInstructionsRevision: profile.customInstructionsRevision,
      memoryLines,
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

  const modelMessages = await convertToModelMessages(filteredMessages);

  const result = streamText({
    model: gateway(effectiveChat.modelId),
    system,
    messages: modelMessages,
    temperature: isRegenerate ? 0.9 : 0,
    stopWhen: [
      hasToolCall("displayWeather"),
      hasToolCall("displayWeatherForecast"),
      hasToolCall("displayMemoryAnswer"),
      stepCountIs(5),
    ],
    tools,
  });

  const headers = {
      "x-remcochat-api-version": REMCOCHAT_API_VERSION,
      "x-remcochat-temporary": "0",
      "x-remcochat-profile-id": profile.id,
      "x-remcochat-chat-id": effectiveChat.id,
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
    };

  const messageMetadata = () => ({
    createdAt: now,
    turnUserMessageId: lastUserMessageId || undefined,
    profileInstructionsRevision: currentProfileRevision,
    chatInstructionsRevision: currentChatRevision,
  });

  return result.toUIMessageStreamResponse({
    headers,
    generateMessageId: nanoid,
    messageMetadata,
  });
}
