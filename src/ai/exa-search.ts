import { webSearch as createRegistryExaSearchTool } from "@exalabs/ai-sdk";
import { tool as createTool } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";

type ExaSearchResult = {
  title?: string;
  url: string;
  id?: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
};

type ExaSearchResponse = {
  requestId?: string;
  results?: ExaSearchResult[];
  searchType?: string;
  type?: string;
  costDollars?: unknown;
};

const DEFAULT_EXA_SEARCH_TYPE = "fast" as const;

function createStrictTool(config: any) {
  return createTool({
    strict: true,
    ...config,
  });
}

function toPositiveInteger(value: unknown, fallback: number, limits: { min: number; max: number }) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(limits.min, Math.min(limits.max, Math.floor(numeric)));
}

export function createExaSearchTool() {
  return createStrictTool({
    description:
      "Search the web with Exa and return content optimized for LLMs (highlights + capped full text).",
    inputSchema: z
      .object({
        query: z.string().describe("The search query."),
        num_results: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Number of results to return."),
        type: z.enum(["instant", "neural", "fast", "auto", "deep"]).optional(),
        livecrawl: z.enum(["never", "fallback", "preferred", "always"]).optional(),
        livecrawl_timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(60_000)
          .optional(),
        text_max_characters: z
          .number()
          .int()
          .min(1000)
          .max(100_000)
          .optional()
          .describe("Max characters of full text to return per result."),
        highlights_num_sentences: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional(),
        highlights_per_url: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional(),
        include_domains: z
          .array(z.string())
          .optional()
          .describe("Restrict results to these domains."),
        exclude_domains: z
          .array(z.string())
          .optional()
          .describe("Exclude results from these domains."),
      })
      .strict(),
    execute: async ({
      query,
      num_results,
      type,
      livecrawl,
      livecrawl_timeout_ms,
      text_max_characters,
      highlights_num_sentences,
      highlights_per_url,
      include_domains,
      exclude_domains,
    }: any) => {
      const config = getConfig().webTools;
      const fallbackInclude =
        config && config.allowedDomains.length > 0 ? config.allowedDomains : undefined;
      const fallbackExclude =
        config && config.blockedDomains.length > 0 ? config.blockedDomains : undefined;
      const maxResults = config?.maxResults ?? 8;

      const includeDomains = include_domains ?? fallbackInclude;
      const excludeDomains = includeDomains
        ? undefined
        : exclude_domains ?? fallbackExclude;
      const textMaxCharacters = toPositiveInteger(text_max_characters, 15_000, {
        min: 1000,
        max: 100_000,
      });
      const highlightsNumSentences = toPositiveInteger(highlights_num_sentences, 3, {
        min: 1,
        max: 10,
      });
      const highlightsPerUrl = toPositiveInteger(highlights_per_url, 3, {
        min: 1,
        max: 10,
      });
      const effectiveType =
        type === "instant" ? DEFAULT_EXA_SEARCH_TYPE : type ?? DEFAULT_EXA_SEARCH_TYPE;
      const registryTool = createRegistryExaSearchTool({
        type: effectiveType,
        numResults: num_results ?? maxResults,
        ...(includeDomains && includeDomains.length > 0 ? { includeDomains } : {}),
        ...(excludeDomains && excludeDomains.length > 0 ? { excludeDomains } : {}),
        contents: {
          text: { maxCharacters: textMaxCharacters },
          highlights: {
            numSentences: highlightsNumSentences,
            highlightsPerUrl,
          },
          livecrawl: livecrawl ?? "preferred",
          ...(livecrawl_timeout_ms ? { livecrawlTimeout: livecrawl_timeout_ms } : {}),
        },
      }) as unknown as {
        execute?: (input: { query: string }) => Promise<ExaSearchResponse>;
      };

      if (typeof registryTool.execute !== "function") {
        throw new Error("Exa registry tool is unavailable.");
      }

      const response = await registryTool.execute({ query });
      const results = Array.isArray(response.results)
        ? response.results.map((result) => ({
            title: result.title ?? "",
            url: result.url,
            id: result.id ?? "",
            publishedDate: result.publishedDate ?? "",
            author: result.author ?? "",
            text: result.text ?? "",
            highlights: Array.isArray(result.highlights) ? result.highlights : [],
          }))
        : [];

      return {
        requestId: response.requestId ?? "",
        searchType: response.searchType ?? response.type ?? effectiveType,
        results,
        costDollars: response.costDollars ?? null,
      };
    },
  });
}
