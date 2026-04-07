import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { nanoid } from "nanoid";
import { createSkillsTools } from "@/ai/skills-tools";

export function shouldRunSkillsToolsSmokeTest(input: {
  explicitSkillName: string | null;
  lastUserText: string;
  toolsEnabled: boolean;
}) {
  return Boolean(
    input.toolsEnabled &&
      input.explicitSkillName === "skills-system-validation" &&
      /\bskillsActivate\b/.test(input.lastUserText) &&
      /\bskillsReadResource\b/.test(input.lastUserText)
  );
}

export function maybeCreateSkillsToolsSmokeTestResponse(input: {
  chatId: string;
  explicitSkillName: string | null;
  lastUserText: string;
  toolsEnabled: boolean;
  skillsEnabled: boolean;
  messageMetadata?: RemcoChatMessageMetadata;
  headers?: HeadersInit;
}) {
  if (
    !shouldRunSkillsToolsSmokeTest({
      explicitSkillName: input.explicitSkillName,
      lastUserText: input.lastUserText,
      toolsEnabled: input.toolsEnabled,
    }) ||
    !input.skillsEnabled
  ) {
    return null;
  }

  const smokeTestSkillName = input.explicitSkillName;
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
        chatId: input.chatId,
      });

      writer.write({
        type: "start",
        messageId,
        messageMetadata: input.messageMetadata,
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
        messageMetadata: input.messageMetadata,
      });
    },
  });

  return createUIMessageStreamResponse({
    headers: input.headers,
    stream,
  });
}
