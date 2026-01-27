import type { UIMessage } from "ai";

export function parseExplicitSkillInvocation(input: {
  text: string;
  skillNames: Set<string>;
}): { skillName: string; strippedText: string } | null {
  const raw = String(input.text ?? "");
  if (!raw.startsWith("/")) return null;

  const match = raw.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+|$)/);
  if (!match?.[1]) return null;

  const skillName = match[1];
  if (!input.skillNames.has(skillName)) return null;

  return {
    skillName,
    strippedText: raw.slice(match[0].length),
  };
}

export function stripExplicitSkillInvocationFromMessages<TMeta>(input: {
  messages: UIMessage<TMeta>[];
  skillNames: Set<string>;
}): { messages: UIMessage<TMeta>[]; explicitSkillName: string | null } {
  if (!input.skillNames || input.skillNames.size === 0) {
    return { messages: input.messages, explicitSkillName: null };
  }

  const messages = input.messages;
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIndex < 0) return { messages, explicitSkillName: null };

  const target = messages[lastUserIndex];
  if (!target) return { messages, explicitSkillName: null };

  const parts = target.parts.slice();
  const textIndex = parts.findIndex((p) => (p as { type?: unknown }).type === "text");
  if (textIndex < 0) return { messages, explicitSkillName: null };

  const part = parts[textIndex] as { type: "text"; text: string };
  const parsed = parseExplicitSkillInvocation({ text: part.text, skillNames: input.skillNames });
  if (!parsed) return { messages, explicitSkillName: null };

  parts[textIndex] = { ...part, text: parsed.strippedText };

  const nextMessage: UIMessage<TMeta> = { ...target, parts };
  const nextMessages = messages.slice();
  nextMessages[lastUserIndex] = nextMessage;

  return { messages: nextMessages, explicitSkillName: parsed.skillName };
}

