import { createBashTools } from "@/ai/bash-tools";
import { createProviderOptionsForWebTools } from "@/ai/provider-options";
import { buildSystemPrompt } from "@/ai/system-prompt";
import { createLocalAccessTools } from "@/ai/local-access-tools";
import type { ToolBundle } from "@/ai/tool-bundle";
import { createWebTools } from "@/ai/web-tools";
import type { ModelType } from "@/server/config-types";
import { getEffectiveReasoning } from "@/server/chat/helpers";
import {
  createChatSkillsRuntime,
} from "@/server/chat/skills-runtime";
import { buildExplicitSkillPromptSections } from "@/server/chat/skills-context";
import { createChatRuntimeHeaderExtras } from "@/server/chat/request-context";
import { prepareChatModelMessages } from "@/server/chat/turn-response";
import { createDisabledToolBundle } from "@/server/chat/tool-loop-utils";
import type { ChatMessage } from "@/server/chat/types";

type ChatRuntimeResolvedModel = {
  providerId: string;
  modelType: ModelType;
  providerModelId: string;
  capabilities: Parameters<typeof createProviderOptionsForWebTools>[0]["capabilities"] & {
    tools: boolean;
  };
};

type ChatPromptResolvedModel = ChatRuntimeResolvedModel & {
  modelId: string;
};

export async function createChatModelRuntime(input: {
  request: Request;
  resolved: ChatRuntimeResolvedModel;
  sessionKey: string | null;
  reasoning: Parameters<typeof createProviderOptionsForWebTools>[0]["reasoning"];
}) {
  const webTools = input.resolved.capabilities.tools
    ? createWebTools({
        providerId: input.resolved.providerId,
        modelType: input.resolved.modelType,
        providerModelId: input.resolved.providerModelId,
      })
    : createDisabledToolBundle();

  const bashTools =
    input.resolved.capabilities.tools && input.sessionKey
      ? await createBashTools({
          request: input.request,
          sessionKey: input.sessionKey,
        })
      : createDisabledToolBundle();

  const localAccessTools = input.resolved.capabilities.tools
    ? createLocalAccessTools({ request: input.request })
    : createDisabledToolBundle();

  return {
    webTools,
    bashTools,
    localAccessTools,
    providerOptions: createProviderOptionsForWebTools({
      modelType: input.resolved.modelType,
      providerModelId: input.resolved.providerModelId,
      webToolsEnabled: webTools.enabled,
      capabilities: input.resolved.capabilities,
      reasoning: input.reasoning,
    }),
    maxSteps: bashTools.enabled ? 20 : webTools.enabled ? 12 : 5,
  };
}

export async function prepareChatExecutionRuntime(input: {
  request: Request;
  resolved: ChatRuntimeResolvedModel;
  configReasoning: Parameters<typeof getEffectiveReasoning>[0]["config"];
  requestedEffort?: string;
  sessionKey: string | null;
  messages: ChatMessage[];
  lastUserText: string;
  chatId?: string;
}) {
  const reasoningSelection = getEffectiveReasoning({
    config: input.configReasoning,
    resolved: input.resolved,
    requestedEffort: input.requestedEffort,
  });

  const modelRuntime = await createChatModelRuntime({
    request: input.request,
    resolved: input.resolved,
    sessionKey: input.sessionKey,
    reasoning: reasoningSelection.effectiveReasoning,
  });

  const skillsRuntime = createChatSkillsRuntime({
    request: input.request,
    messages: input.messages,
    lastUserText: input.lastUserText,
    ...(input.chatId ? { chatId: input.chatId } : {}),
  });

  return {
    reasoningSelection,
    skillsRuntime,
    ...modelRuntime,
  };
}

export function createChatPromptArtifacts(input: {
  resolved: ChatPromptResolvedModel;
  reasoning: Parameters<typeof createChatRuntimeHeaderExtras>[0]["reasoning"];
  prompt: {
    isTemporary: boolean;
    profileInstructions: string;
    profileInstructionsRevision: number;
    chatInstructions: string;
    systemChatInstructionsRevision: number;
    headerChatInstructionsRevision: number;
    storedProfileInstructions?: string;
    memoryEnabled: boolean;
    memoryLines: string[];
    activatedSkillNames: string[];
  };
  skills: {
    skillsRegistry: Parameters<typeof buildExplicitSkillPromptSections>[0]["skillsRegistry"];
    availableSkills: Array<{ name: string; description: string }>;
    explicitSkillName: string | null;
    maxSkillMdBytes: number;
  };
  tools: {
    webTools: ToolBundle;
    localAccessTools: ToolBundle;
    bashTools: ToolBundle;
    ovNlTools: ToolBundle;
  };
  bashToolsConfig: {
    provider?: string;
    runtime?: string;
  };
  attachmentsEnabled: boolean;
  ovNlPromptPolicy: {
    toolAllowed?: boolean;
    toolConfidence?: number;
  };
  explicitBashCommand?: string | null;
  extraSections?: string[];
  isRegenerate?: boolean;
}) {
  const system = buildChatSystemPrompt({
    systemPrompt: {
      isTemporary: input.prompt.isTemporary,
      chatInstructions: input.prompt.chatInstructions,
      chatInstructionsRevision: input.prompt.systemChatInstructionsRevision,
      profileInstructions: input.prompt.profileInstructions,
      profileInstructionsRevision: input.prompt.profileInstructionsRevision,
      memoryEnabled: input.prompt.memoryEnabled,
      memoryLines: input.prompt.memoryLines,
      skillsEnabled: Boolean(input.skills.skillsRegistry),
      availableSkills: input.skills.availableSkills,
      activatedSkillNames: input.prompt.activatedSkillNames,
      toolsEnabled: input.resolved.capabilities.tools,
      webToolsEnabled: input.tools.webTools.enabled,
      bashToolsEnabled: input.tools.bashTools.enabled,
      bashToolsProvider: input.bashToolsConfig.provider,
      bashToolsRuntime: input.bashToolsConfig.runtime,
      attachmentsEnabled: input.attachmentsEnabled,
      ovNlToolsEnabled: input.tools.ovNlTools.enabled,
      ovNlToolAllowed: input.ovNlPromptPolicy.toolAllowed,
      ovNlToolConfidence: input.ovNlPromptPolicy.toolConfidence ?? undefined,
    },
    explicitSkillName: input.skills.explicitSkillName,
    skillsRegistry: input.skills.skillsRegistry,
    toolsEnabled: input.resolved.capabilities.tools,
    maxSkillMdBytes: input.skills.maxSkillMdBytes,
    explicitBashCommand: input.explicitBashCommand,
    extraSections: input.extraSections,
  });

  const headerExtras = createChatRuntimeHeaderExtras({
    resolved: input.resolved,
    reasoning: input.reasoning,
    profileInstructions: input.prompt.profileInstructions,
    profileInstructionsRevision: input.prompt.profileInstructionsRevision,
    chatInstructions: input.prompt.chatInstructions,
    chatInstructionsRevision: input.prompt.headerChatInstructionsRevision,
    storedProfileInstructions: input.prompt.storedProfileInstructions,
    webTools: input.tools.webTools,
    localAccessTools: input.tools.localAccessTools,
    bashTools: input.tools.bashTools,
    ovNlTools: input.tools.ovNlTools,
  });

  return {
    system,
    headerExtras,
    temperature: resolveChatTemperature({
      resolved: input.resolved,
      isRegenerate: input.isRegenerate,
    }),
  };
}

export function resolveChatTemperature(input: {
  resolved: ChatPromptResolvedModel;
  isRegenerate?: boolean;
}) {
  if (!input.resolved.capabilities.temperature) return undefined;
  if (input.resolved.capabilities.reasoning) return undefined;
  return input.isRegenerate ? 0.9 : 0;
}

export async function prepareChatExecutionArtifacts(
  input: Parameters<typeof createChatPromptArtifacts>[0] & {
    profileId: string;
    messages: ChatMessage[];
  },
) {
  const promptArtifacts = createChatPromptArtifacts(input);
  const modelMessages = await prepareChatModelMessages({
    profileId: input.profileId,
    messages: input.messages,
  });

  return {
    ...promptArtifacts,
    modelMessages,
  };
}

export function buildChatSystemPrompt(input: {
  systemPrompt: Parameters<typeof buildSystemPrompt>[0];
  explicitSkillName: string | null;
  skillsRegistry: Parameters<typeof buildExplicitSkillPromptSections>[0]["skillsRegistry"];
  toolsEnabled: boolean;
  maxSkillMdBytes: number;
  explicitBashCommand?: string | null;
  extraSections?: string[];
}) {
  const systemParts = [
    buildSystemPrompt(input.systemPrompt),
    ...buildExplicitSkillPromptSections({
      explicitSkillName: input.explicitSkillName,
      skillsRegistry: input.skillsRegistry,
      toolsEnabled: input.toolsEnabled,
      maxSkillMdBytes: input.maxSkillMdBytes,
    }),
  ];

  if (input.explicitBashCommand) {
    systemParts.push(
      [
        "The user provided an explicit shell command and requested using the bash tool.",
        "Call the bash tool with the command exactly as written, then stop. Do not add any other text unless the user asked.",
        `Command: \`${input.explicitBashCommand}\``,
      ].join("\n"),
    );
  }

  for (const section of input.extraSections ?? []) {
    if (section) {
      systemParts.push(section);
    }
  }

  return systemParts.join("\n\n");
}
