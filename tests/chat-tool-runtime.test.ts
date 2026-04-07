import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createToolBundle,
  defineToolEntry,
} from "../src/ai/tool-bundle";
import {
  prepareChatToolingRuntime,
  type ChatGatewayRuntime,
} from "../src/server/chat/tool-runtime";

function bundleFromEntries(
  entries: Array<{
    name: string;
    group: "display" | "web" | "sandbox" | "host-read" | "host-exec" | "skills" | "hue" | "ov";
    risk?: "safe" | "approval";
  }>,
) {
  return createToolBundle({
    enabled: entries.length > 0,
    entries: entries.map((entry) =>
      defineToolEntry({
        name: entry.name,
        tool: {},
        metadata: {
          group: entry.group,
          risk: entry.risk ?? "safe",
        },
      }),
    ),
  });
}

function createBaseToolLoopInput() {
  return {
    profileId: "profile-1",
    isTemporary: true,
    memoryEnabled: false,
    lastUserText: "turn the lights off",
    previousUserText: "",
    resolved: {
      model: {} as any,
      capabilities: {
        tools: true,
        temperature: false,
      },
    },
    routedIntent: { intent: "none", confidence: 0 } as const,
    routerContext: {},
    maxSteps: 5,
    explicitBashCommand: null,
    explicitSkillActivationOnly: false,
    forceToolName: null,
    stopAfterCurrentDateTime: false,
    stopAfterTimezones: false,
    baseSystem: "Base system prompt",
    webTools: bundleFromEntries([]),
    localAccessTools: bundleFromEntries([]),
    bashTools: bundleFromEntries([]),
    skillsTools: bundleFromEntries([]),
    ovNlTools: bundleFromEntries([]),
  };
}

test("prepareChatToolingRuntime threads hue relevance into the tool loop surface", async () => {
  const gatewayRuntime: ChatGatewayRuntime = {
    hueSkillRelevant: true,
    hueGatewayTools: bundleFromEntries([{ name: "hueGateway", group: "hue" }]),
    ovNlPolicy: {
      skillForced: false,
      allowByRouter: false,
      forceFastPath: false,
      toolAllowedForPrompt: undefined,
      routerConfidence: null,
    },
    forceOvNlGatewayTool: false,
    executeOvGateway: null,
  };

  const result = await prepareChatToolingRuntime({
    gatewayRuntime,
    ovFastPath: {
      enabled: false,
      blocked: true,
      explicitSkillActivationOnly: false,
      text: "turn the lights off",
      previousUserText: "",
      messages: [],
    },
    toolLoop: {
      ...createBaseToolLoopInput(),
    },
  });

  assert.equal(result.response, null);
  const activeTools = result.toolLoop?.prepareStep({ stepNumber: 0, steps: [] }).activeTools;
  assert.deepEqual(activeTools, ["hueGateway"]);
});

test("prepareChatToolingRuntime threads forced OV routing into the tool loop when fast path is blocked", async () => {
  const ovNlTools = bundleFromEntries([{ name: "ovNlGateway", group: "ov" }]);
  const gatewayRuntime: ChatGatewayRuntime = {
    hueSkillRelevant: false,
    hueGatewayTools: bundleFromEntries([]),
    ovNlPolicy: {
      skillForced: true,
      allowByRouter: false,
      forceFastPath: true,
      toolAllowedForPrompt: true,
      routerConfidence: null,
    },
    forceOvNlGatewayTool: true,
    executeOvGateway: null,
  };

  const result = await prepareChatToolingRuntime({
    gatewayRuntime,
    ovFastPath: {
      enabled: true,
      blocked: true,
      explicitSkillActivationOnly: false,
      text: "van amsterdam centraal naar utrecht centraal vandaag",
      previousUserText: "",
      messages: [],
    },
    toolLoop: {
      ...createBaseToolLoopInput(),
      lastUserText: "van amsterdam centraal naar utrecht centraal vandaag",
      ovNlTools,
    },
  });

  assert.equal(result.response, null);
  const activeTools = result.toolLoop?.prepareStep({ stepNumber: 0, steps: [] }).activeTools;
  assert.deepEqual(activeTools, ["ovNlGateway"]);
});
