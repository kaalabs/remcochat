import { createHueGatewayTools } from "@/ai/hue-gateway-tools";
import { buildToolLoopController } from "@/ai/tool-loop";
import type { ToolBundle } from "@/ai/tool-bundle";
import { createTools } from "@/ai/tools";
import type { IntentRoute } from "@/server/intent-router";
import { computeOvNlRoutingPolicy, type OvNlRoutingPolicy } from "@/server/ov/ov-nl-routing-policy";
import { tryOvIntentFastPath } from "@/server/chat/ov-fast-path";
import { resolveToolSurfaceDecision } from "@/server/tool-surface-router";
import {
  assertServerOwnedToolLoopBundle,
  routeToolSurfaceSafely,
} from "@/server/chat/tool-loop-utils";
import type { StreamTextToolSet } from "@/server/chat/types";

type OvGatewayExecute = (input: unknown) => Promise<unknown>;

type ChatToolLoopResolvedModel = {
  model: Parameters<typeof createTools>[0]["model"];
  capabilities: {
    tools: boolean;
    temperature: boolean;
  };
};

export type ChatGatewayRuntime = {
  hueSkillRelevant: boolean;
  hueGatewayTools: ToolBundle;
  ovNlPolicy: OvNlRoutingPolicy;
  forceOvNlGatewayTool: boolean;
  executeOvGateway: OvGatewayExecute | null;
};

function isHueSkillRelevant(input: {
  explicitSkillName: string | null;
  activatedSkillNames?: string[];
}) {
  return (
    input.explicitSkillName === "hue-instant-control" ||
    (input.activatedSkillNames ?? []).includes("hue-instant-control")
  );
}

export function createChatGatewayRuntime(input: {
  request: Request;
  isTemporary: boolean;
  routedIntent: IntentRoute | null;
  explicitSkillName: string | null;
  activatedSkillNames?: string[];
  ovNlTools: ToolBundle;
  chatId?: string;
  temporarySessionId?: string;
  turnUserMessageId?: string;
}): ChatGatewayRuntime {
  const hueSkillRelevant = isHueSkillRelevant({
    explicitSkillName: input.explicitSkillName,
    activatedSkillNames: input.activatedSkillNames,
  });
  const hueGatewayTools = createHueGatewayTools({
    request: input.request,
    isTemporary: input.isTemporary,
    skillRelevant: hueSkillRelevant,
    ...(input.chatId ? { chatId: input.chatId } : {}),
    ...(input.temporarySessionId ? { temporarySessionId: input.temporarySessionId } : {}),
    turnUserMessageId: input.turnUserMessageId ?? "",
  });
  const ovNlPolicy = computeOvNlRoutingPolicy({
    routedIntent: input.routedIntent,
    explicitSkillName: input.explicitSkillName,
  });
  const executeOvGateway = (
    input.ovNlTools.tools as {
      ovNlGateway?: { execute?: OvGatewayExecute };
    }
  ).ovNlGateway?.execute;

  return {
    hueSkillRelevant,
    hueGatewayTools,
    ovNlPolicy,
    forceOvNlGatewayTool: ovNlPolicy.forceFastPath,
    executeOvGateway: typeof executeOvGateway === "function" ? executeOvGateway : null,
  };
}

export async function createChatToolLoopRuntime(input: {
  profileId: string;
  chatId?: string;
  isTemporary: boolean;
  memoryEnabled: boolean;
  viewerTimeZone?: string;
  lastUserText: string;
  previousUserText: string;
  resolved: ChatToolLoopResolvedModel;
  routedIntent: IntentRoute | null;
  routerContext: {
    lastAssistantText?: string;
    lastToolName?: string;
  };
  forceOvNlTool: boolean;
  hueSkillRelevant: boolean;
  maxSteps: number;
  explicitBashCommand: string | null;
  explicitSkillActivationOnly: boolean;
  forceToolName?: string | null;
  stopAfterCurrentDateTime: boolean;
  stopAfterTimezones: boolean;
  baseSystem: string;
  webTools: ToolBundle;
  localAccessTools: ToolBundle;
  bashTools: ToolBundle;
  skillsTools: ToolBundle;
  hueGatewayTools: ToolBundle;
  ovNlTools: ToolBundle;
}) {
  const chatTools = createTools({
    ...(input.chatId ? { chatId: input.chatId } : {}),
    profileId: input.profileId,
    isTemporary: input.isTemporary,
    memoryEnabled: input.memoryEnabled,
    viewerTimeZone: input.viewerTimeZone,
    toolContext: {
      lastUserText: input.lastUserText,
      previousUserText: input.previousUserText,
    },
    model: input.resolved.capabilities.tools ? input.resolved.model : undefined,
    supportsTemperature: input.resolved.capabilities.temperature,
  });

  const routedToolSurface = input.resolved.capabilities.tools
    ? await routeToolSurfaceSafely({
        text: input.lastUserText,
        context: input.routerContext,
      })
    : null;

  const initialToolSurface = resolveToolSurfaceDecision({
    routedToolSurface,
    routedIntent: input.routedIntent,
    lastUserText: input.lastUserText,
    forceOvNlTool: input.forceOvNlTool,
    hueSkillRelevant: input.hueSkillRelevant,
  });

  const toolLoop = input.resolved.capabilities.tools
    ? buildToolLoopController({
        bundles: [
          chatTools,
          input.webTools,
          input.localAccessTools,
          input.bashTools,
          input.skillsTools,
          input.hueGatewayTools,
          input.ovNlTools,
        ],
        maxSteps: input.maxSteps,
        explicitBashCommand: input.explicitBashCommand,
        explicitSkillActivationOnly: input.explicitSkillActivationOnly,
        forceToolName: input.forceToolName ?? null,
        stopAfterCurrentDateTime: input.stopAfterCurrentDateTime,
        stopAfterTimezones: input.stopAfterTimezones,
        routedToolSurface: initialToolSurface,
        baseSystem: input.baseSystem,
      })
    : null;

  if (toolLoop) {
    assertServerOwnedToolLoopBundle(toolLoop.bundle);
  }

  return {
    toolLoop,
    streamTools: toolLoop?.bundle.tools as StreamTextToolSet | undefined,
  };
}

export async function prepareChatToolLoopExecution(
  input: Omit<
    Parameters<typeof createChatToolLoopRuntime>[0],
    "forceOvNlTool" | "hueSkillRelevant" | "hueGatewayTools"
  > & {
    gatewayRuntime: ChatGatewayRuntime;
  },
) {
  return await createChatToolLoopRuntime({
    ...input,
    forceOvNlTool: input.gatewayRuntime.forceOvNlGatewayTool,
    hueSkillRelevant: input.gatewayRuntime.hueSkillRelevant,
    hueGatewayTools: input.gatewayRuntime.hueGatewayTools,
  });
}

type OvFastPathRuntimeInput = Omit<
  Parameters<typeof tryOvIntentFastPath>[0],
  "shouldTry" | "executeOvGateway"
> & {
  blocked?: boolean;
};

export async function prepareChatToolingRuntime(input: {
  gatewayRuntime: ChatGatewayRuntime;
  ovFastPath: OvFastPathRuntimeInput;
  toolLoop: Omit<
    Parameters<typeof createChatToolLoopRuntime>[0],
    "forceOvNlTool" | "hueSkillRelevant" | "hueGatewayTools"
  >;
}): Promise<
  | { response: Response; gatewayRuntime: ChatGatewayRuntime }
  | ({
      response: null;
      gatewayRuntime: ChatGatewayRuntime;
    } & Awaited<ReturnType<typeof createChatToolLoopRuntime>>)
> {
  const ovFastPath = await tryOvIntentFastPath({
    ...input.ovFastPath,
    shouldTry:
      !input.ovFastPath.blocked && input.gatewayRuntime.forceOvNlGatewayTool,
    executeOvGateway: input.gatewayRuntime.executeOvGateway,
  });
  if (ovFastPath) {
    return {
      response: ovFastPath,
      gatewayRuntime: input.gatewayRuntime,
    };
  }

  const toolLoopRuntime = await prepareChatToolLoopExecution({
    gatewayRuntime: input.gatewayRuntime,
    ...input.toolLoop,
  });

  return {
    response: null,
    gatewayRuntime: input.gatewayRuntime,
    ...toolLoopRuntime,
  };
}
