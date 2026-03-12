import { hasToolCall, stepCountIs, type ToolChoice } from "ai";
import {
  listToolNamesByGroup,
  mergeToolBundles,
  type ToolBundle,
} from "@/ai/tool-bundle";
import { repairDisplayAgendaInput } from "@/ai/tools";
import type { ToolSurface } from "@/server/tool-surface-router";

type ToolLoopControllerInput = {
  bundles: ToolBundle[];
  maxSteps: number;
  explicitBashCommand: string | null;
  explicitSkillActivationOnly: boolean;
  forceToolName?: string | null;
  stopAfterCurrentDateTime?: boolean;
  stopAfterTimezones?: boolean;
  routedToolSurface?: ToolSurface | null;
  baseSystem: string;
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value && value.trim())));
}

function toolCallsFromSteps(steps: Array<{ toolCalls?: Array<{ toolName?: string }> }>) {
  const names: string[] = [];
  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      if (typeof call.toolName === "string" && call.toolName.trim()) {
        names.push(call.toolName);
      }
    }
  }
  return unique(names);
}

function buildStepLocalSystem(baseSystem: string, activeTools: string[]) {
  const suffix =
    activeTools.length > 0
      ? [
          "Step-local tool access policy:",
          `Only these tools are available in this step: ${activeTools.join(", ")}.`,
          "Do not reference, call, or rely on any other tool in this step.",
          "If a tool execution is denied, do not retry the same tool unless the user changes the request.",
        ].join("\n")
      : [
          "Step-local tool access policy:",
          "No tools are available in this step.",
          "Do not attempt any tool calls.",
        ].join("\n");

  return `${baseSystem}\n\n${suffix}`;
}

function toolsForSurface(bundle: ToolBundle, surface: ToolSurface | null | undefined) {
  switch (surface) {
    case "display_weather":
      return bundle.tools.displayWeather ? ["displayWeather"] : [];
    case "display_weather_forecast":
      return bundle.tools.displayWeatherForecast ? ["displayWeatherForecast"] : [];
    case "display_agenda":
      return bundle.tools.displayAgenda ? ["displayAgenda"] : [];
    case "display_list":
      return unique(
        ["displayList", "displayListsOverview"].filter((name) => Boolean(bundle.tools[name])),
      );
    case "display_notes":
      return bundle.tools.displayNotes ? ["displayNotes"] : [];
    case "display_url_summary":
      return bundle.tools.displayUrlSummary ? ["displayUrlSummary"] : [];
    case "display_current_datetime":
      return bundle.tools.displayCurrentDateTime ? ["displayCurrentDateTime"] : [];
    case "display_timezones":
      return bundle.tools.displayTimezones ? ["displayTimezones"] : [];
    case "obsidian":
      return bundle.tools.obsidian ? ["obsidian"] : [];
    case "host_access":
      return unique([
        ...listToolNamesByGroup(bundle, "host-read"),
        ...listToolNamesByGroup(bundle, "host-exec"),
      ]);
    case "workspace_exec":
      return listToolNamesByGroup(bundle, "sandbox");
    case "ov_nl":
      return bundle.tools.ovNlGateway ? ["ovNlGateway"] : [];
    case "hue":
      return bundle.tools.hueGateway ? ["hueGateway"] : [];
    case "web":
      return listToolNamesByGroup(bundle, "web");
    default:
      return [];
  }
}

function buildInitialActiveTools(input: {
  bundle: ToolBundle;
  explicitBashCommand: string | null;
  explicitSkillActivationOnly: boolean;
  forceToolName?: string | null;
  stopAfterCurrentDateTime?: boolean;
  stopAfterTimezones?: boolean;
  routedToolSurface?: ToolSurface | null;
}) {
  const { bundle } = input;
  if (input.forceToolName && bundle.tools[input.forceToolName]) {
    return [input.forceToolName];
  }
  if (input.explicitSkillActivationOnly && bundle.tools.skillsActivate) {
    return ["skillsActivate"];
  }
  if (input.explicitBashCommand && bundle.tools.bash) {
    return ["bash"];
  }
  if (input.stopAfterCurrentDateTime && bundle.tools.displayCurrentDateTime) {
    return ["displayCurrentDateTime"];
  }
  if (input.stopAfterTimezones && bundle.tools.displayTimezones) {
    return ["displayTimezones"];
  }

  const routedTools = toolsForSurface(bundle, input.routedToolSurface);
  if (routedTools.length > 0) {
    return routedTools;
  }

  return unique([
    ...listToolNamesByGroup(bundle, "display"),
    ...listToolNamesByGroup(bundle, "web"),
  ]);
}

function buildFollowupActiveTools(bundle: ToolBundle, priorToolNames: string[], fallback: string[]) {
  const active = new Set<string>();
  for (const toolName of priorToolNames) {
    const metadata = bundle.metadataByName[toolName];
    if (!metadata) continue;
    switch (metadata.group) {
      case "web":
        for (const name of listToolNamesByGroup(bundle, "web")) active.add(name);
        break;
      case "sandbox":
        for (const name of listToolNamesByGroup(bundle, "sandbox")) active.add(name);
        break;
      case "host-read":
        for (const name of listToolNamesByGroup(bundle, "host-read")) active.add(name);
        break;
      case "host-exec":
        for (const name of [
          ...listToolNamesByGroup(bundle, "host-read"),
          ...listToolNamesByGroup(bundle, "host-exec"),
        ]) {
          active.add(name);
        }
        break;
      case "skills":
        for (const name of listToolNamesByGroup(bundle, "skills")) active.add(name);
        break;
      case "hue":
        active.add("hueGateway");
        break;
      case "ov":
        active.add("ovNlGateway");
        break;
      case "display":
        if (toolName === "displayMemoryPrompt") {
          active.add("displayMemoryPrompt");
        }
        break;
    }
  }

  if (active.size === 0) {
    for (const name of fallback) active.add(name);
  }

  return Array.from(active);
}

export function buildToolLoopController(input: ToolLoopControllerInput) {
  const bundle = mergeToolBundles(...input.bundles);
  const initialActiveTools = buildInitialActiveTools({
    bundle,
    explicitBashCommand: input.explicitBashCommand,
    explicitSkillActivationOnly: input.explicitSkillActivationOnly,
    forceToolName: input.forceToolName,
    stopAfterCurrentDateTime: input.stopAfterCurrentDateTime,
    stopAfterTimezones: input.stopAfterTimezones,
    routedToolSurface: input.routedToolSurface,
  });

  const stopToolNames = [
    "displayWeather",
    "displayWeatherForecast",
    ...(input.stopAfterCurrentDateTime ? ["displayCurrentDateTime"] : []),
    ...(input.stopAfterTimezones ? ["displayTimezones"] : []),
    "displayNotes",
    "displayMemoryPrompt",
    "displayMemoryAnswer",
    "displayList",
    "displayListsOverview",
    "displayAgenda",
    "displayUrlSummary",
    "summarizeURL",
  ].filter((toolName) => Boolean(bundle.tools[toolName]));

  const toolChoice: ToolChoice<any> | undefined =
    input.forceToolName && bundle.tools[input.forceToolName]
      ? ({ type: "tool", toolName: input.forceToolName } as const)
      : input.explicitBashCommand && bundle.tools.bash
        ? ({ type: "tool", toolName: "bash" } as const)
      : undefined;

  return {
    bundle,
    toolChoice,
    initialSystem: buildStepLocalSystem(input.baseSystem, initialActiveTools),
    stopWhen: [
      ...stopToolNames.map((toolName) => hasToolCall(toolName)),
      stepCountIs(input.maxSteps),
    ],
    prepareStep: ({
      stepNumber,
      steps,
    }: {
      stepNumber: number;
      steps: Array<{ toolCalls?: Array<{ toolName?: string }> }>;
    }) => {
      const activeTools =
        stepNumber === 0
          ? initialActiveTools
          : buildFollowupActiveTools(bundle, toolCallsFromSteps(steps), initialActiveTools);

      return {
        activeTools,
        ...(stepNumber === 0 && toolChoice ? { toolChoice } : {}),
        system: buildStepLocalSystem(input.baseSystem, activeTools),
      };
    },
    experimental_repairToolCall: async ({
      toolCall,
    }: {
      toolCall: { toolName?: string; input?: unknown; toolCallId: string };
    }) => {
      if (toolCall.toolName !== "displayAgenda") return null;
      const repaired = repairDisplayAgendaInput(toolCall.input);
      if (!repaired) return null;
      return {
        type: "tool-call" as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: JSON.stringify(repaired),
      };
    },
  };
}
