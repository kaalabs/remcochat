export type ModelOption = {
  id: string;
  label: string;
  description?: string;
};

export const MODEL_ALLOWLIST: ModelOption[] = [
  { id: "openai/gpt-5", label: "GPT-5", description: "OpenAI" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini", description: "OpenAI" },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    description: "Anthropic",
  },
];

export const DEFAULT_MODEL_ID = MODEL_ALLOWLIST[0]?.id ?? "openai/gpt-5";

export function isAllowedModel(id: unknown): id is string {
  if (typeof id !== "string") return false;
  return MODEL_ALLOWLIST.some((m) => m.id === id);
}

export function getModelLabel(id: string): string {
  return MODEL_ALLOWLIST.find((m) => m.id === id)?.label ?? id;
}

