import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { UIMessage } from "ai";
import type { RemcoChatMessageMetadata } from "../src/domain/chats/types";
import {
  createChat,
  forkChatFromUserMessage,
  getChat,
  listTurnAssistantTexts,
  loadChatState,
  saveChatState,
} from "../src/server/chats";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetDbForTests } from "../src/server/db";
import { createProfile } from "../src/server/profiles";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_DB_PATH = process.env.REMCOCHAT_DB_PATH;

function makeTempPath(prefix: string, ext: string) {
  return path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
}

function writeTempConfigToml() {
  const filePath = makeTempPath("remcochat-config", ".toml");
  fs.writeFileSync(
    filePath,
    `
version = 2

[app]
default_provider_id = "vercel"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`.trim() + "\n",
    "utf8",
  );
  return filePath;
}

afterEach(() => {
  _resetConfigCacheForTests();
  _resetDbForTests();

  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.REMCOCHAT_CONFIG_PATH;
  else process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;

  if (ORIGINAL_DB_PATH === undefined) delete process.env.REMCOCHAT_DB_PATH;
  else process.env.REMCOCHAT_DB_PATH = ORIGINAL_DB_PATH;
});

test("chat service saves state, infers title, and preserves fork variants", () => {
  process.env.REMCOCHAT_DB_PATH = makeTempPath("remcochat-db", ".sqlite");
  process.env.REMCOCHAT_CONFIG_PATH = writeTempConfigToml();
  _resetDbForTests();
  _resetConfigCacheForTests();

  const profile = createProfile({ name: "P1" });
  const chat = createChat({ profileId: profile.id, title: "" });

  const messages: UIMessage<RemcoChatMessageMetadata>[] = [
    {
      id: "user-1",
      role: "user",
      metadata: { createdAt: "2026-03-25T10:00:00.000Z" },
      parts: [{ type: "text", text: "Plan the sprint backlog and risks for next week" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      metadata: {
        createdAt: "2026-03-25T10:00:05.000Z",
        profileInstructionsRevision: 2,
        chatInstructionsRevision: 3,
      },
      parts: [{ type: "text", text: "Draft response" }],
    },
  ];

  const variantsByUserMessageId: Record<string, UIMessage<RemcoChatMessageMetadata>[]> = {
    "user-1": [
      {
        id: "assistant-variant-1",
        role: "assistant" as const,
        metadata: { createdAt: "2026-03-25T10:00:06.000Z" },
        parts: [{ type: "text" as const, text: "Alternative draft" }],
      },
    ],
  };

  saveChatState({
    chatId: chat.id,
    profileId: profile.id,
    messages,
    variantsByUserMessageId,
  });

  const refreshed = getChat(chat.id);
  assert.equal(refreshed.title, "Plan the sprint backlog and risks for next week");

  const state = loadChatState(chat.id);
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[1]?.metadata?.turnUserMessageId, "user-1");
  assert.equal(state.variantsByUserMessageId["user-1"]?.length, 1);

  assert.deepEqual(
    listTurnAssistantTexts({ chatId: chat.id, turnUserMessageId: "user-1" }),
    ["Alternative draft", "Draft response"],
  );

  const fork = forkChatFromUserMessage({
    profileId: profile.id,
    chatId: chat.id,
    userMessageId: "user-1",
    text: "Refine the sprint scope",
  });

  assert.equal(fork.forkedFromChatId, chat.id);
  assert.equal(fork.forkedFromMessageId, "user-1");

  const forkState = loadChatState(fork.id);
  assert.equal(forkState.messages.length, 1);
  const firstPart = forkState.messages[0]?.parts.find((part) => part.type === "text");
  assert.equal(firstPart?.type, "text");
  assert.equal(firstPart?.text, "Refine the sprint scope");

  const forkVariants = forkState.variantsByUserMessageId["user-1"] ?? [];
  assert.equal(forkVariants.length, 2);
  assert.deepEqual(
    forkVariants
      .map((variant) =>
        variant.parts.find((part) => part.type === "text" && typeof part.text === "string"),
      )
      .map((part) => (part && part.type === "text" ? part.text : ""))
      .sort(),
    ["Alternative draft", "Draft response"],
  );
});
