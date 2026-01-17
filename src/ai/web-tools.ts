import type { ModelType } from "@/server/config";
import { getConfig } from "@/server/config";
import { anthropic as anthropicTools } from "@ai-sdk/anthropic";
import { openai as openaiTools } from "@ai-sdk/openai";
import {
  getAnthropicProviderForProviderId,
  getGatewayProviderForProviderId,
  getGoogleProviderForProviderId,
  getOpenAIProviderForProviderId,
} from "@/server/llm-provider";

export type WebToolsResult = {
  enabled: boolean;
  tools: Record<string, any>;
};

export function createWebTools(input: {
  providerId: string;
  modelType: ModelType;
  providerModelId: string;
}): WebToolsResult {
  const web = getConfig().webTools;
  if (!web || !web.enabled) return { enabled: false, tools: {} };

  switch (input.modelType) {
    case "vercel_ai_gateway": {
      if (input.providerModelId.startsWith("openai/")) {
        const allowedDomains =
          web.allowedDomains.length > 0 ? web.allowedDomains : undefined;

        return {
          enabled: true,
          tools: {
            web_search: openaiTools.tools.webSearch({
              ...(allowedDomains ? { filters: { allowedDomains } } : {}),
            }),
          },
        };
      }

      const gateway = getGatewayProviderForProviderId(input.providerId);
      const searchDomainFilter =
        web.allowedDomains.length > 0
          ? web.allowedDomains
          : web.blockedDomains.length > 0
            ? web.blockedDomains.map((domain) => `-${domain}`)
            : undefined;

      const allowedDomains =
        web.allowedDomains.length > 0 ? web.allowedDomains : undefined;
      const blockedDomains =
        web.blockedDomains.length > 0 ? web.blockedDomains : undefined;

      const tools: Record<string, any> = {
        perplexity_search: gateway.tools.perplexitySearch({
          maxResults: web.maxResults,
          ...(web.recency ? { searchRecencyFilter: web.recency } : {}),
          ...(searchDomainFilter ? { searchDomainFilter } : {}),
        }),
      };

      if (input.providerModelId.startsWith("anthropic/")) {
        tools.web_fetch = anthropicTools.tools.webFetch_20250910({
          maxUses: 3,
          citations: { enabled: true },
          maxContentTokens: 4000,
          ...(allowedDomains ? { allowedDomains } : {}),
          ...(blockedDomains ? { blockedDomains } : {}),
        });
      }

      return {
        enabled: true,
        tools,
      };
    }
    case "openai_responses": {
      const openai = getOpenAIProviderForProviderId(input.providerId);
      const allowedDomains =
        web.allowedDomains.length > 0 ? web.allowedDomains : undefined;

      return {
        enabled: true,
        tools: {
          web_search: openai.tools.webSearch({
            ...(allowedDomains ? { filters: { allowedDomains } } : {}),
          }),
        },
      };
    }
    case "anthropic_messages": {
      const anthropic = getAnthropicProviderForProviderId(input.providerId);
      const allowedDomains =
        web.allowedDomains.length > 0 ? web.allowedDomains : undefined;
      const blockedDomains =
        web.blockedDomains.length > 0 ? web.blockedDomains : undefined;

      return {
        enabled: true,
        tools: {
          web_search: anthropic.tools.webSearch_20250305({
            maxUses: 3,
            ...(allowedDomains ? { allowedDomains } : {}),
            ...(blockedDomains ? { blockedDomains } : {}),
          }),
          web_fetch: anthropic.tools.webFetch_20250910({
            maxUses: 3,
            citations: { enabled: true },
            maxContentTokens: 4000,
            ...(allowedDomains ? { allowedDomains } : {}),
            ...(blockedDomains ? { blockedDomains } : {}),
          }),
        },
      };
    }
    case "google_generative_ai": {
      const google = getGoogleProviderForProviderId(input.providerId);
      return {
        enabled: true,
        tools: {
          google_search: google.tools.googleSearch({}),
          url_context: google.tools.urlContext({}),
        },
      };
    }
    default:
      return { enabled: false, tools: {} };
  }
}
