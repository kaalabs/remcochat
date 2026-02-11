import { xaiReasoningEffortSupport } from "@/lib/xai-capabilities";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export type ReasoningEffortChoice = "auto" | ReasoningEffort;

const OPENAI_LEVELS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];
const STANDARD_LEVELS: ReasoningEffort[] = ["low", "medium", "high"];

function vendorFromModelId(modelId: string | undefined) {
  const id = String(modelId ?? "").trim();
  if (!id.includes("/")) return "";
  return id.split("/")[0]?.toLowerCase() ?? "";
}

export function allowedReasoningEfforts(input: {
  modelType?: string;
  providerModelId?: string;
  webToolsEnabled?: boolean;
}): ReasoningEffort[] {
  const modelType = input.modelType ?? "";
  const webToolsEnabled = Boolean(input.webToolsEnabled);

  // OpenAI web_search tool is incompatible with reasoning.effort=minimal.
  // When web tools are enabled, we exclude "minimal" for the model types that
  // advertise web_search.
  if (webToolsEnabled) {
    if (modelType === "openai_responses") return STANDARD_LEVELS;
    if (modelType === "vercel_ai_gateway") {
      const vendor = vendorFromModelId(input.providerModelId);
      if (vendor === "openai") return STANDARD_LEVELS;
    }
  }

  if (modelType === "openai_responses") return OPENAI_LEVELS;
  if (modelType === "openai_compatible") return STANDARD_LEVELS;
  if (modelType === "xai") {
    const support = xaiReasoningEffortSupport(input.providerModelId);
    if (support !== "supported") return [];
    return STANDARD_LEVELS;
  }
  if (modelType === "anthropic_messages") return STANDARD_LEVELS;
  if (modelType === "google_generative_ai") return STANDARD_LEVELS;
  if (modelType === "vercel_ai_gateway") {
    const vendor = vendorFromModelId(input.providerModelId);
    if (vendor === "openai") return OPENAI_LEVELS;
    if (vendor === "anthropic") return STANDARD_LEVELS;
    if (vendor === "google") return STANDARD_LEVELS;
    return STANDARD_LEVELS;
  }
  return [];
}

export function normalizeReasoningEffort(
  value: string | undefined,
  allowed: ReasoningEffort[]
): ReasoningEffortChoice {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (allowed.includes(normalized as ReasoningEffort)) {
    return normalized as ReasoningEffort;
  }
  return "auto";
}
