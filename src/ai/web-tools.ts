import type { ModelType } from "@/server/config";
import { getConfig } from "@/server/config";
import { anthropic as anthropicTools } from "@ai-sdk/anthropic";
import { openai as openaiTools } from "@ai-sdk/openai";
import {
  getAnthropicProviderForProviderId,
  getGatewayProviderForProviderId,
  getOpenAIProviderForProviderId,
} from "@/server/llm-provider";
import { createExaSearchTool } from "@/ai/exa-search";
import { createBraveSearchTool } from "@/ai/brave-search";
import { createToolBundle, defineToolEntry, type ToolBundle } from "@/ai/tool-bundle";

export type WebToolsResult = ToolBundle;

function createLocalSearchBundle(searchProvider: "exa" | "brave") {
  return createToolBundle({
    enabled: true,
    entries: [
      defineToolEntry({
        name: searchProvider === "brave" ? "brave_search" : "exa_search",
        metadata: {
          group: "web",
          risk: "safe",
          strict: true,
        },
        tool:
          searchProvider === "brave"
            ? createBraveSearchTool()
            : createExaSearchTool(),
      }),
    ],
  });
}

export function createWebTools(input: {
  providerId: string;
  modelType: ModelType;
  providerModelId: string;
}): WebToolsResult {
  const web = getConfig().webTools;
  if (!web || !web.enabled) return createToolBundle({ enabled: false, entries: [] });

  switch (input.modelType) {
    case "vercel_ai_gateway": {
      if (input.providerModelId.startsWith("openai/")) {
        const allowedDomains =
          web.allowedDomains.length > 0 ? web.allowedDomains : undefined;

        return createToolBundle({
          enabled: true,
          entries: [
            defineToolEntry({
              name: "web_search",
              metadata: {
                group: "web",
                risk: "safe",
                providerDefined: true,
              },
              tool: openaiTools.tools.webSearch({
                ...(allowedDomains ? { filters: { allowedDomains } } : {}),
              }),
            }),
          ],
        });
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

      const entries = [
        defineToolEntry({
          name: "perplexity_search",
          metadata: {
            group: "web",
            risk: "safe",
            providerDefined: true,
          },
          tool: gateway.tools.perplexitySearch({
            maxResults: web.maxResults,
            ...(web.recency ? { searchRecencyFilter: web.recency } : {}),
            ...(searchDomainFilter ? { searchDomainFilter } : {}),
          }),
        }),
      ];

      if (input.providerModelId.startsWith("anthropic/")) {
        entries.push(
          defineToolEntry({
            name: "web_fetch",
            metadata: {
              group: "web",
              risk: "safe",
              providerDefined: true,
            },
            tool: anthropicTools.tools.webFetch_20250910({
              maxUses: 3,
              citations: { enabled: true },
              maxContentTokens: 4000,
              ...(allowedDomains ? { allowedDomains } : {}),
              ...(blockedDomains ? { blockedDomains } : {}),
            }),
          }),
        );
      }

      return createToolBundle({ enabled: true, entries });
    }
    case "openai_responses": {
      const openai = getOpenAIProviderForProviderId(input.providerId);
      const allowedDomains =
        web.allowedDomains.length > 0 ? web.allowedDomains : undefined;

      return createToolBundle({
        enabled: true,
        entries: [
          defineToolEntry({
            name: "web_search",
            metadata: {
              group: "web",
              risk: "safe",
              providerDefined: true,
            },
            tool: openai.tools.webSearch({
              ...(allowedDomains ? { filters: { allowedDomains } } : {}),
            }),
          }),
        ],
      });
    }
    case "openai_compatible": {
      return createLocalSearchBundle(web.searchProvider);
    }
    case "xai": {
      // Use local web-search tools for xAI to avoid deprecated Chat live-search
      // parameters while preserving RemcoChat's existing tool flow.
      return createLocalSearchBundle(web.searchProvider);
    }
    case "anthropic_messages": {
      if (input.providerModelId.startsWith("anthropic/")) {
        // Gateway-routed Anthropic models are exposed as anthropic_messages in
        // RemcoChat's catalog, but Anthropic-native provider-defined web tools
        // attach beta headers the gateway path rejects. Keep web access via the
        // local search tools instead.
        return createLocalSearchBundle(web.searchProvider);
      }
      const anthropic = getAnthropicProviderForProviderId(input.providerId);
      const allowedDomains =
        web.allowedDomains.length > 0 ? web.allowedDomains : undefined;
      const blockedDomains =
        web.blockedDomains.length > 0 ? web.blockedDomains : undefined;

      return createToolBundle({
        enabled: true,
        entries: [
          defineToolEntry({
            name: "web_search",
            metadata: {
              group: "web",
              risk: "safe",
              providerDefined: true,
            },
            tool: anthropic.tools.webSearch_20250305({
              maxUses: 3,
              ...(allowedDomains ? { allowedDomains } : {}),
              ...(blockedDomains ? { blockedDomains } : {}),
            }),
          }),
          defineToolEntry({
            name: "web_fetch",
            metadata: {
              group: "web",
              risk: "safe",
              providerDefined: true,
            },
            tool: anthropic.tools.webFetch_20250910({
              maxUses: 3,
              citations: { enabled: true },
              maxContentTokens: 4000,
              ...(allowedDomains ? { allowedDomains } : {}),
              ...(blockedDomains ? { blockedDomains } : {}),
            }),
          }),
        ],
      });
    }
    case "google_generative_ai": {
      // The Google adapter exposes provider-defined tools (google_search, url_context),
      // but RemcoChat always also supplies function tools. The AI SDK does not support
      // mixing these for Gemini, so we use local web-search tools here.
      return createLocalSearchBundle(web.searchProvider);
    }
    default:
      return createToolBundle({ enabled: false, entries: [] });
  }
}
