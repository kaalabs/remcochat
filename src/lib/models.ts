export type ModelCapabilities = {
  tools: boolean;
  reasoning: boolean;
  temperature: boolean;
  attachments: boolean;
  structuredOutput: boolean;
};

export type ModelCapabilityKey = keyof ModelCapabilities;

export const MODEL_CAPABILITY_LABELS: Record<ModelCapabilityKey, string> = {
  tools: "Tools",
  reasoning: "Reasoning",
  temperature: "Temp",
  attachments: "Files",
  structuredOutput: "JSON",
};

export function listModelCapabilityBadges(capabilities: ModelCapabilities) {
  return (Object.keys(MODEL_CAPABILITY_LABELS) as ModelCapabilityKey[]).map(
    (key) => ({
      key,
      label: MODEL_CAPABILITY_LABELS[key],
      enabled: capabilities[key],
    })
  );
}

export type ModelOption = {
  id: string;
  label: string;
  description?: string;
  type?: string;
  capabilities?: ModelCapabilities;
};
