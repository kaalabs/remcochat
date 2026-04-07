import assert from "node:assert/strict";
import { test } from "node:test";
import { createToolBundle } from "../src/ai/tool-bundle";
import {
  createChatPromptArtifacts,
  prepareChatExecutionArtifacts,
  resolveChatTemperature,
} from "../src/server/chat/chat-runtime";
import type { ChatMessage } from "../src/server/chat/types";

function bundle(names: string[]) {
  const out = createToolBundle({
    enabled: names.length > 0,
    entries: [],
  });
  for (const name of names) {
    out.tools[name] = {};
  }
  return out;
}

function createBaseInput() {
  return {
    resolved: {
      providerId: "vercel",
      modelType: "vercel_ai_gateway" as const,
      providerModelId: "openai/gpt-4o-mini",
      modelId: "openai/gpt-4o-mini",
      capabilities: {
        reasoning: false,
        temperature: true,
        tools: true,
        attachments: false,
        structuredOutput: false,
      },
    },
    reasoning: {
      enabled: true,
      exposeToClient: true,
      requestedEffort: "medium",
      effectiveEffort: "medium",
    },
    prompt: {
      isTemporary: false,
      profileInstructions: "Be concise",
      profileInstructionsRevision: 3,
      chatInstructions: "Focus on trains",
      systemChatInstructionsRevision: 7,
      headerChatInstructionsRevision: 5,
      storedProfileInstructions: "Stored profile text",
      memoryEnabled: true,
      memoryLines: ["- likes trains"],
      activatedSkillNames: ["ov-nl-travel"],
    },
    skills: {
      skillsRegistry: null,
      availableSkills: [{ name: "ov-nl-travel", description: "Transit help" }],
      explicitSkillName: "ov-nl-travel",
      maxSkillMdBytes: 200_000,
    },
    tools: {
      webTools: bundle(["web_search"]),
      localAccessTools: bundle([]),
      bashTools: bundle(["bash"]),
      ovNlTools: bundle(["ovNlGateway"]),
    },
    bashToolsConfig: {
      provider: "vercel",
      runtime: "node20",
    },
    attachmentsEnabled: true,
    ovNlPromptPolicy: {
      toolAllowed: true,
      toolConfidence: 0.88,
    },
    explicitBashCommand: "echo hi",
    extraSections: ["Extra section"],
  };
}

test("createChatPromptArtifacts centralizes system prompt, runtime headers, and temperature", () => {
  const artifacts = createChatPromptArtifacts(createBaseInput());

  assert.match(artifacts.system, /Command: `echo hi`/);
  assert.match(artifacts.system, /Extra section/);
  assert.equal(artifacts.headerExtras["x-remcochat-chat-instructions-rev"], "5");
  assert.equal(
    artifacts.headerExtras["x-remcochat-profile-instructions-stored-len"],
    String("Stored profile text".length),
  );
  assert.equal(artifacts.temperature, 0);
});

test("prepareChatExecutionArtifacts also converts chat messages and supports regenerate temperature", async () => {
  const messages: ChatMessage[] = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Plan my train trip" }],
    },
  ];

  const artifacts = await prepareChatExecutionArtifacts({
    ...createBaseInput(),
    isRegenerate: true,
    profileId: "p1",
    messages,
  });

  assert.equal(artifacts.temperature, 0.9);
  assert.ok(Array.isArray(artifacts.modelMessages));
  assert.match(JSON.stringify(artifacts.modelMessages), /Plan my train trip/);
});

test("resolveChatTemperature disables temperature when the model reasons intrinsically", () => {
  assert.equal(
    resolveChatTemperature({
      resolved: {
        ...createBaseInput().resolved,
        capabilities: {
          reasoning: true,
          temperature: true,
          tools: true,
          attachments: false,
          structuredOutput: false,
        },
      },
      isRegenerate: true,
    }),
    undefined,
  );
});
