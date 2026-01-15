export type ModelOption = {
  id: string;
  label: string;
  description?: string;
};

export const MODEL_ALLOWLIST: ModelOption[] = [
  { id: "openai/gpt-5.2-chat", label: "GPT 5.2 Chat", description: "OpenAI" },
  { id: "openai/gpt-4o-mini", label: "GPT 4o Mini", description: "OpenAI" },
  { id: "openai/gpt-5.2-pro", label: "GPT 5.2 PRO", description: "OpenAI" },
  { id: "openai/gpt-5.2-codex", label: "GPT 5.2 Codex", description: "OpenAI" },
];

export const DEFAULT_MODEL_ID = MODEL_ALLOWLIST[0]?.id ?? "openai/gpt-5";

export function isAllowedModel(id: unknown): id is string {
  if (typeof id !== "string") return false;
  return MODEL_ALLOWLIST.some((m) => m.id === id);
}

export function getModelLabel(id: string): string {
  return MODEL_ALLOWLIST.find((m) => m.id === id)?.label ?? id;
}

