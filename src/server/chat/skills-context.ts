import { OV_NL_SKILL_NAME } from "@/server/ov/ov-nl-constants";
import {
  isExplicitSkillActivationOnlyPrompt,
  stripExplicitSkillInvocationFromMessages,
} from "@/server/skills/explicit-invocation";
import type { SkillsRegistry } from "@/server/skills/types";
import { readFileForPrompt } from "@/server/chat/helpers";
import type { ChatMessage } from "@/server/chat/types";

export type AvailableSkill = ReturnType<SkillsRegistry["list"]>[number];

export type ChatSkillInvocation = {
  messages: ChatMessage[];
  explicitSkillName: string | null;
};

export type ChatSkillsContext = {
  availableSkills: AvailableSkill[];
  skillInvocation: ChatSkillInvocation;
  explicitSkillActivationOnly: boolean;
};

export function isExplicitOvNlSkillUnavailable(input: {
  explicitSkillCandidate: string | null;
  skillsRegistry: SkillsRegistry | null;
  ovNlToolsEnabled: boolean;
}): boolean {
  return (
    input.explicitSkillCandidate === OV_NL_SKILL_NAME &&
    Boolean(input.skillsRegistry?.get(OV_NL_SKILL_NAME)) &&
    !input.ovNlToolsEnabled
  );
}

export function listAvailableSkills(input: {
  skillsRegistry: SkillsRegistry | null;
  ovNlToolsEnabled: boolean;
}): AvailableSkill[] {
  if (!input.skillsRegistry) return [];

  const skills = input.skillsRegistry.list();
  if (input.ovNlToolsEnabled) return skills;

  return skills.filter((skill) => skill.name !== OV_NL_SKILL_NAME);
}

export function prepareChatSkillsContext(input: {
  messages: ChatMessage[];
  skillsRegistry: SkillsRegistry | null;
  ovNlToolsEnabled: boolean;
}): ChatSkillsContext {
  const availableSkills = listAvailableSkills({
    skillsRegistry: input.skillsRegistry,
    ovNlToolsEnabled: input.ovNlToolsEnabled,
  });
  const skillInvocation = stripExplicitSkillInvocationFromMessages({
    messages: input.messages,
    skillNames: new Set(availableSkills.map((skill) => skill.name)),
  });
  const explicitSkillActivationOnly = isExplicitSkillActivationOnlyPrompt({
    messages: skillInvocation.messages,
    explicitSkillName: skillInvocation.explicitSkillName,
  });

  return {
    availableSkills,
    skillInvocation,
    explicitSkillActivationOnly,
  };
}

export function buildExplicitSkillPromptSections(input: {
  explicitSkillName: string | null;
  skillsRegistry: SkillsRegistry | null;
  toolsEnabled: boolean;
  maxSkillMdBytes: number;
}): string[] {
  if (!input.explicitSkillName) return [];

  const sections = [
    [
      `Explicit skill invocation detected: /${input.explicitSkillName}`,
      `Call skillsActivate first with name="${input.explicitSkillName}".`,
    ].join("\n"),
  ];

  if (input.toolsEnabled) return sections;

  const record = input.skillsRegistry?.get(input.explicitSkillName) ?? null;
  if (!record) return sections;

  const skillMd = readFileForPrompt(record.skillMdPath, input.maxSkillMdBytes);
  sections.push(
    [
      `Explicit skill invocation detected (/${record.name}). Tool calling is unavailable for this model, so the skill's SKILL.md is injected below.`,
      skillMd,
    ].join("\n\n"),
  );

  return sections;
}
