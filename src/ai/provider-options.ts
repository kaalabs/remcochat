import type { ModelType } from "@/server/config";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { ModelCapabilities } from "@/lib/models";
import { xaiReasoningEffortSupport } from "@/lib/xai-capabilities";

export type ReasoningConfig = {
  enabled: boolean;
  effort: "minimal" | "low" | "medium" | "high";
  exposeToClient: boolean;
  openaiSummary: string | null;
  anthropicBudgetTokens: number | null;
  googleThinkingBudget: number | null;
};

function vendorFromProviderModelId(providerModelId: string) {
  const id = String(providerModelId ?? "").trim();
  if (!id.includes("/")) return "";
  return id.split("/")[0]?.toLowerCase() ?? "";
}

function reasoningEffortForOpenAI(effort: ReasoningConfig["effort"]) {
  // OpenAI supports: none|minimal|low|medium|high|xhigh. We intentionally keep the
  // RemcoChat config surface small and map directly.
  return effort;
}

function reasoningEffortForOpenAICompatible(effort: ReasoningConfig["effort"]) {
  // OpenAI-compatible gateways typically accept a string value.
  return effort;
}

function reasoningEffortForXaiChat(
  effort: ReasoningConfig["effort"]
) {
  if (effort === "minimal" || effort === "low") return "low";
  return effort;
}

function thinkingLevelForGoogle(effort: ReasoningConfig["effort"]) {
  return effort;
}

function thinkingEffortForAnthropic(effort: ReasoningConfig["effort"]) {
  // Anthropic exposes low|medium|high in provider options; map minimal -> low.
  if (effort === "minimal") return "low";
  return effort;
}

function appendOptions(
  out: SharedV3ProviderOptions,
  provider: string,
  patch: Record<string, unknown>
) {
  const existing = out[provider];
  out[provider] = {
    ...(existing && typeof existing === "object" ? existing : {}),
    ...patch,
  } as never;
}

export function createProviderOptions(input: {
  modelType: ModelType;
  providerModelId: string;
  capabilities: ModelCapabilities;
  webToolsEnabled: boolean;
  reasoning: ReasoningConfig;
}): SharedV3ProviderOptions | undefined {
  const out: SharedV3ProviderOptions = {};
  const effort = input.reasoning.effort;
  const vendor = vendorFromProviderModelId(input.providerModelId);
  const reasoningEnabled =
    input.reasoning.enabled && input.capabilities.reasoning;

  if (!reasoningEnabled) return undefined;

  switch (input.modelType) {
    case "openai_responses": {
      appendOptions(out, "openai", {
        reasoningEffort: reasoningEffortForOpenAI(effort),
        ...(input.reasoning.openaiSummary
          ? { reasoningSummary: input.reasoning.openaiSummary }
          : {}),
      });
      break;
    }
    case "openai_compatible": {
      appendOptions(out, "openaiCompatible", {
        reasoningEffort: reasoningEffortForOpenAICompatible(effort),
      });
      break;
    }
    case "xai": {
      if (xaiReasoningEffortSupport(input.providerModelId) !== "supported") {
        break;
      }
      appendOptions(out, "xai", {
        reasoningEffort: reasoningEffortForXaiChat(effort),
      });
      break;
    }
    case "anthropic_messages": {
      appendOptions(out, "anthropic", {
        // Enable thinking; expose reasoning only when explicitly enabled.
        sendReasoning: input.reasoning.exposeToClient,
        thinking: {
          type: "enabled",
          ...(input.reasoning.anthropicBudgetTokens
            ? { budgetTokens: input.reasoning.anthropicBudgetTokens }
            : {}),
        },
        // Some Anthropic adapters also accept a top-level effort.
        effort: thinkingEffortForAnthropic(effort),
      });
      break;
    }
    case "google_generative_ai": {
      appendOptions(out, "google", {
        thinkingConfig: {
          thinkingLevel: thinkingLevelForGoogle(effort),
          includeThoughts: input.reasoning.exposeToClient,
          ...(input.reasoning.googleThinkingBudget
            ? { thinkingBudget: input.reasoning.googleThinkingBudget }
            : {}),
        },
      });
      break;
    }
    case "vercel_ai_gateway": {
      if (vendor === "openai") {
        appendOptions(out, "openai", {
          reasoningEffort: reasoningEffortForOpenAI(effort),
          ...(input.reasoning.openaiSummary
            ? { reasoningSummary: input.reasoning.openaiSummary }
            : {}),
        });
      } else if (vendor === "anthropic") {
        appendOptions(out, "anthropic", {
          sendReasoning: input.reasoning.exposeToClient,
          thinking: {
            type: "enabled",
            ...(input.reasoning.anthropicBudgetTokens
              ? { budgetTokens: input.reasoning.anthropicBudgetTokens }
              : {}),
          },
          effort: thinkingEffortForAnthropic(effort),
        });
      } else if (vendor === "google") {
        appendOptions(out, "google", {
          thinkingConfig: {
            thinkingLevel: thinkingLevelForGoogle(effort),
            includeThoughts: input.reasoning.exposeToClient,
            ...(input.reasoning.googleThinkingBudget
              ? { thinkingBudget: input.reasoning.googleThinkingBudget }
              : {}),
          },
        });
      }
      break;
    }
    default:
      break;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function createProviderOptionsForWebTools(input: {
  modelType: ModelType;
  providerModelId: string;
  webToolsEnabled: boolean;
  capabilities: ModelCapabilities;
  reasoning: ReasoningConfig;
}): SharedV3ProviderOptions | undefined {
  return createProviderOptions({
    modelType: input.modelType,
    providerModelId: input.providerModelId,
    webToolsEnabled: input.webToolsEnabled,
    capabilities: input.capabilities,
    reasoning: input.reasoning,
  });
}
