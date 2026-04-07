import assert from "node:assert/strict";
import { test } from "node:test";
import { createToolBundle } from "../src/ai/tool-bundle";
import { executePreparedChatTurn } from "../src/server/chat/turn-execution";
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

function createExecutionInput() {
  const messages: ChatMessage[] = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Plan my train trip" }],
    },
  ];

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
    profileId: "p1",
    messages,
  };
}

test("executePreparedChatTurn returns an attachment-processing UI response when artifact preparation fails", async () => {
  const response = await executePreparedChatTurn(
    {
      execution: createExecutionInput(),
      attachmentError: {
        headers: { "x-remcochat-test": "1" },
        messageMetadata: { createdAt: "2026-03-26T00:00:00Z" },
      },
      createToolingInput() {
        throw new Error("should not prepare tooling");
      },
      createStreamInput() {
        throw new Error("should not stream");
      },
    },
    {
      async prepareExecutionArtifactsImpl() {
        throw new Error("attachment worker failed");
      },
    },
  );

  assert.equal(response.headers.get("x-remcochat-test"), "1");
  const text = await response.text();
  assert.match(text, /Attachment processing error: attachment worker failed/);
  assert.match(text, /2026-03-26T00:00:00Z/);
});

test("executePreparedChatTurn returns a tooling short-circuit response before stream execution", async () => {
  const shortCircuit = new Response("shortcut", {
    headers: { "x-remcochat-short": "1" },
  });
  let streamCalled = false;

  const response = await executePreparedChatTurn(
    {
      execution: createExecutionInput(),
      attachmentError: {
        headers: {},
      },
      createToolingInput() {
        return { gatewayRuntime: {} as any, ovFastPath: {} as any, toolLoop: {} as any };
      },
      createStreamInput() {
        throw new Error("should not stream");
      },
    },
    {
      async prepareExecutionArtifactsImpl() {
        return {
          system: "system",
          headerExtras: {},
          modelMessages: [],
          temperature: 0,
        } as any;
      },
      async prepareToolingRuntimeImpl() {
        return {
          response: shortCircuit,
          gatewayRuntime: {} as any,
        } as any;
      },
      runPreparedChatStreamResponseImpl() {
        streamCalled = true;
        return new Response("stream");
      },
    },
  );

  assert.equal(response, shortCircuit);
  assert.equal(streamCalled, false);
});

test("executePreparedChatTurn passes prepared artifacts and tooling outputs into final stream execution", async () => {
  let capturedToolingInput: unknown = null;
  let capturedStreamInput: any = null;

  const response = await executePreparedChatTurn(
    {
      execution: createExecutionInput(),
      attachmentError: {
        headers: {},
      },
      createToolingInput(artifacts) {
        return {
          gatewayRuntime: {} as any,
          ovFastPath: {
            enabled: true,
            text: "Plan my train trip",
            previousUserText: "",
            messages: [],
            messageMetadata: { createdAt: "2026-03-26T00:00:00Z" },
            headers: { "x-remcochat-base": "1" },
          },
          toolLoop: {
            profileId: "p1",
            isTemporary: true,
            memoryEnabled: false,
            lastUserText: "Plan my train trip",
            previousUserText: "",
            resolved: {
              model: {},
              capabilities: {
                tools: true,
                temperature: true,
              },
            },
            routedIntent: null,
            routerContext: {},
            forceToolName: null,
            maxSteps: 5,
            explicitBashCommand: null,
            explicitSkillActivationOnly: false,
            stopAfterCurrentDateTime: false,
            stopAfterTimezones: false,
            baseSystem: artifacts.system,
            webTools: bundle(["web_search"]),
            localAccessTools: bundle([]),
            bashTools: bundle([]),
            skillsTools: bundle([]),
            ovNlTools: bundle([]),
          },
        } as any;
      },
      createStreamInput(artifacts) {
        return {
          headers: { "x-remcochat-header": String(artifacts.headerExtras["x-extra"]) },
          resolvedModel: {
            model: {} as any,
            providerId: "vercel",
            providerModelId: "openai/gpt-4o-mini",
            modelType: "vercel_ai_gateway",
            modelId: "openai/gpt-4o-mini",
            capabilities: {
              tools: true,
              reasoning: false,
              temperature: true,
            },
          },
          providers: [],
          baseMessageMetadata: { createdAt: "2026-03-26T00:00:00Z" },
          sendReasoning: true,
          createMessageId: () => "m1",
          lastUserText: "Plan my train trip",
          providerOptions: { gateway: { extraBody: {} } },
          webTools: bundle(["web_search"]),
          explicitBashCommandFromUser: null,
        } as any;
      },
    },
    {
      async prepareExecutionArtifactsImpl(execution) {
        return {
          system: "prepared-system",
          headerExtras: { "x-extra": "42" },
          modelMessages: execution.messages as any,
          temperature: 0.9,
        } as any;
      },
      async prepareToolingRuntimeImpl(input) {
        capturedToolingInput = input;
        return {
          response: null,
          gatewayRuntime: {} as any,
          toolLoop: null,
          streamTools: undefined,
        } as any;
      },
      runPreparedChatStreamResponseImpl(input) {
        capturedStreamInput = input as unknown as Record<string, unknown>;
        return new Response("stream-ok", {
          headers: input.headers,
        });
      },
    },
  );

  assert.equal(response.headers.get("x-remcochat-header"), "42");
  assert.equal((capturedToolingInput as any)?.toolLoop?.baseSystem, "prepared-system");
  assert.equal(capturedStreamInput?.system, "prepared-system");
  assert.equal(capturedStreamInput?.temperature, 0.9);
  assert.deepEqual(capturedStreamInput?.modelMessages, createExecutionInput().messages);
  assert.equal(capturedStreamInput?.toolLoop, null);
  assert.equal(capturedStreamInput?.explicitBashCommandFromUser, null);
});
