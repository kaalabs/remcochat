import assert from "node:assert/strict";
import { test } from "node:test";
import { buildToolLoopController } from "../src/ai/tool-loop";
import { createToolBundle, defineToolEntry } from "../src/ai/tool-bundle";

function createTestBundle() {
  return createToolBundle({
    enabled: true,
    entries: [
      defineToolEntry({
        name: "displayWeather",
        tool: {},
        metadata: { group: "display", risk: "safe" },
      }),
      defineToolEntry({
        name: "displayAgenda",
        tool: {},
        metadata: { group: "display", risk: "safe", repairStrategy: "displayAgenda" },
      }),
      defineToolEntry({
        name: "bash",
        tool: {},
        metadata: { group: "sandbox", risk: "approval", needsApproval: true },
      }),
      defineToolEntry({
        name: "readFile",
        tool: {},
        metadata: { group: "sandbox", risk: "safe" },
      }),
      defineToolEntry({
        name: "web_search",
        tool: {},
        metadata: { group: "web", risk: "safe", providerDefined: true },
      }),
      defineToolEntry({
        name: "skillsActivate",
        tool: {},
        metadata: { group: "skills", risk: "safe" },
      }),
      defineToolEntry({
        name: "skillsReadResource",
        tool: {},
        metadata: { group: "skills", risk: "safe" },
      }),
      defineToolEntry({
        name: "localExec",
        tool: {},
        metadata: { group: "host-exec", risk: "approval", needsApproval: true },
      }),
      defineToolEntry({
        name: "localReadFile",
        tool: {},
        metadata: { group: "host-read", risk: "safe" },
      }),
      defineToolEntry({
        name: "obsidian",
        tool: {},
        metadata: { group: "host-exec", risk: "approval", needsApproval: true },
      }),
      defineToolEntry({
        name: "ovNlGateway",
        tool: {},
        metadata: { group: "ov", risk: "safe" },
      }),
      defineToolEntry({
        name: "hueGateway",
        tool: {},
        metadata: { group: "hue", risk: "safe" },
      }),
    ],
  });
}

test("tool loop forces bash when the user explicitly requested bash execution", () => {
  const loop = buildToolLoopController({
    bundles: [createTestBundle()],
    maxSteps: 5,
    explicitBashCommand: "npm test",
    explicitSkillActivationOnly: false,
    baseSystem: "Base system prompt",
  });

  assert.deepEqual(loop.prepareStep({ stepNumber: 0, steps: [] }).activeTools, ["bash"]);
  assert.deepEqual(loop.toolChoice, { type: "tool", toolName: "bash" });
});

test("tool loop narrows web-research requests to web tools on step 0", () => {
  const loop = buildToolLoopController({
    bundles: [createTestBundle()],
    maxSteps: 5,
    explicitBashCommand: null,
    explicitSkillActivationOnly: false,
    routedToolSurface: "web",
    baseSystem: "Base system prompt",
  });

  assert.deepEqual(loop.prepareStep({ stepNumber: 0, steps: [] }).activeTools, ["web_search"]);
});

test("tool loop keeps only weather display tool for direct weather requests", () => {
  const loop = buildToolLoopController({
    bundles: [createTestBundle()],
    maxSteps: 5,
    explicitBashCommand: null,
    explicitSkillActivationOnly: false,
    routedToolSurface: "display_weather",
    baseSystem: "Base system prompt",
  });

  assert.deepEqual(loop.prepareStep({ stepNumber: 0, steps: [] }).activeTools, [
    "displayWeather",
  ]);
});

test("tool loop expands skills follow-up steps after activation", () => {
  const loop = buildToolLoopController({
    bundles: [createTestBundle()],
    maxSteps: 5,
    explicitBashCommand: null,
    explicitSkillActivationOnly: true,
    baseSystem: "Base system prompt",
  });

  assert.deepEqual(loop.prepareStep({ stepNumber: 0, steps: [] }).activeTools, [
    "skillsActivate",
  ]);

  const next = loop.prepareStep({
    stepNumber: 1,
    steps: [{ toolCalls: [{ toolName: "skillsActivate" }] }],
  });
  assert.deepEqual(next.activeTools.sort(), ["skillsActivate", "skillsReadResource"]);
});

test("tool loop exposes sandbox tools for routed workspace execution", () => {
  const loop = buildToolLoopController({
    bundles: [createTestBundle()],
    maxSteps: 5,
    explicitBashCommand: null,
    explicitSkillActivationOnly: false,
    routedToolSurface: "workspace_exec",
    baseSystem: "Base system prompt",
  });

  assert.deepEqual(loop.prepareStep({ stepNumber: 0, steps: [] }).activeTools.sort(), [
    "bash",
    "readFile",
  ]);
});

test("tool loop exposes host read and exec tools for routed host access", () => {
  const loop = buildToolLoopController({
    bundles: [createTestBundle()],
    maxSteps: 5,
    explicitBashCommand: null,
    explicitSkillActivationOnly: false,
    routedToolSurface: "host_access",
    baseSystem: "Base system prompt",
  });

  assert.deepEqual(loop.prepareStep({ stepNumber: 0, steps: [] }).activeTools.sort(), [
    "localExec",
    "localReadFile",
    "obsidian",
  ]);
});

test("tool loop exposes only obsidian for routed obsidian access", () => {
  const loop = buildToolLoopController({
    bundles: [createTestBundle()],
    maxSteps: 5,
    explicitBashCommand: null,
    explicitSkillActivationOnly: false,
    routedToolSurface: "obsidian",
    baseSystem: "Base system prompt",
  });

  assert.deepEqual(loop.prepareStep({ stepNumber: 0, steps: [] }).activeTools, ["obsidian"]);
});
