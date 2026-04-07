import type { RemcoChatConfig, RemcoChatProvider } from "./config-types";
import type {
  RawIntentRouterConfig,
  RawReasoningConfig,
  RawWebToolsConfig,
} from "./config-normalize-types";
import { clampInt, uniqueTrimmedStrings } from "./config-normalize-shared";

export function normalizeIntentRouter(
  rawRouter: RawIntentRouterConfig | undefined,
  providers: RemcoChatProvider[]
): RemcoChatConfig["intentRouter"] {
  const router = rawRouter ?? {};
  if (!Boolean(router.enabled ?? false)) {
    return null;
  }

  const providerId = String(router.provider_id ?? "").trim();
  if (!providerId) {
    throw new Error("config.toml: app.router.provider_id is required when router is enabled");
  }

  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new Error(
      `config.toml: app.router.provider_id "${providerId}" is not present in providers`
    );
  }

  const modelId = String(router.model_id ?? "").trim();
  if (!modelId) {
    throw new Error("config.toml: app.router.model_id is required when router is enabled");
  }

  if (!provider.allowedModelIds.includes(modelId)) {
    throw new Error(
      `config.toml: app.router.model_id "${modelId}" is not present in providers.${providerId}.allowed_model_ids`
    );
  }

  return {
    enabled: true,
    providerId,
    modelId,
    minConfidence: Math.min(1, Math.max(0, Number(router.min_confidence ?? 0.7))),
    maxInputChars: clampInt(router.max_input_chars, 20, 4000, 600),
  };
}

export function normalizeWebTools(
  rawWebTools: RawWebToolsConfig | undefined
): RemcoChatConfig["webTools"] {
  const webTools = rawWebTools ?? {};
  if (!Boolean(webTools.enabled ?? false)) {
    return null;
  }

  const allowedDomains = uniqueTrimmedStrings(webTools.allowed_domains);
  const blockedDomains = uniqueTrimmedStrings(webTools.blocked_domains);
  if (allowedDomains.length > 0 && blockedDomains.length > 0) {
    throw new Error(
      "config.toml: app.web_tools.allowed_domains and app.web_tools.blocked_domains cannot both be set"
    );
  }

  return {
    enabled: true,
    searchProvider: webTools.search_provider ?? "exa",
    maxResults: clampInt(webTools.max_results, 1, 20, 8),
    recency: webTools.recency ?? null,
    allowedDomains,
    blockedDomains,
  };
}

export function normalizeReasoning(
  rawReasoning: RawReasoningConfig | undefined
): RemcoChatConfig["reasoning"] {
  const reasoning = rawReasoning ?? {};
  const openaiSummaryRaw = String(reasoning.openai_summary ?? "").trim();
  const anthropicBudgetRaw = reasoning.anthropic_budget_tokens;
  const googleBudgetRaw = reasoning.google_thinking_budget;

  return {
    enabled: Boolean(reasoning.enabled ?? true),
    effort: reasoning.effort ?? "medium",
    exposeToClient: Boolean(reasoning.expose_to_client ?? false),
    openaiSummary: openaiSummaryRaw ? openaiSummaryRaw : null,
    anthropicBudgetTokens:
      typeof anthropicBudgetRaw === "number" && Number.isFinite(anthropicBudgetRaw)
        ? Math.max(0, Math.floor(anthropicBudgetRaw)) || null
        : null,
    googleThinkingBudget:
      typeof googleBudgetRaw === "number" && Number.isFinite(googleBudgetRaw)
        ? Math.max(0, Math.floor(googleBudgetRaw)) || null
        : null,
  };
}
