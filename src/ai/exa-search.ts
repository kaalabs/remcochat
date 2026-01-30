import { tool as createTool } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";

type ExaSearchResult = {
  title?: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
};

type ExaSearchResponse = {
  requestId?: string;
  results?: ExaSearchResult[];
  searchType?: string;
  costDollars?: unknown;
};

type ExaSearchInput = {
  query: string;
  numResults: number;
  type?: "neural" | "fast" | "auto" | "deep";
  livecrawl?: "never" | "fallback" | "preferred" | "always";
  livecrawlTimeout?: number;
  textMaxCharacters?: number;
  highlightsNumSentences?: number;
  highlightsPerUrl?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
};

function getExaApiKey() {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("Missing EXA_API_KEY for Exa search.");
  return key;
}

async function runExaSearch(input: ExaSearchInput): Promise<ExaSearchResponse> {
  const key = getExaApiKey();
  const textMaxCharacters = Math.max(
    1000,
    Math.min(100_000, Math.floor(input.textMaxCharacters ?? 15000))
  );
  const highlightsNumSentences = Math.max(
    1,
    Math.min(10, Math.floor(input.highlightsNumSentences ?? 3))
  );
  const highlightsPerUrl = Math.max(
    1,
    Math.min(10, Math.floor(input.highlightsPerUrl ?? 3))
  );
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify({
      query: input.query,
      numResults: input.numResults,
      type: input.type ?? "auto",
      livecrawl: input.livecrawl ?? "preferred",
      ...(input.livecrawlTimeout
        ? { livecrawlTimeout: input.livecrawlTimeout }
        : {}),
      // Best-practice defaults: cap full text and include highlights for token efficiency.
      text: { maxCharacters: textMaxCharacters },
      highlights: {
        numSentences: highlightsNumSentences,
        highlightsPerUrl,
      },
      ...(input.includeDomains && input.includeDomains.length > 0
        ? { includeDomains: input.includeDomains }
        : {}),
      ...(input.excludeDomains && input.excludeDomains.length > 0
        ? { excludeDomains: input.excludeDomains }
        : {}),
    }),
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(
      `Exa search failed: ${res.status} ${res.statusText} ${message}`.trim()
    );
  }

  return (await res.json()) as ExaSearchResponse;
}

export function createExaSearchTool() {
  return createTool({
    description:
      "Search the web with Exa and return content optimized for LLMs (highlights + capped full text).",
    inputSchema: z.object({
      query: z.string().describe("The search query."),
      num_results: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe("Number of results to return."),
      type: z.enum(["neural", "fast", "auto", "deep"]).optional(),
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
    }),
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
    }) => {
      const config = getConfig().webTools;
      const fallbackInclude =
        config && config.allowedDomains.length > 0
          ? config.allowedDomains
          : undefined;
      const fallbackExclude =
        config && config.blockedDomains.length > 0
          ? config.blockedDomains
          : undefined;
      const maxResults = config?.maxResults ?? 8;

      const includeDomains = include_domains ?? fallbackInclude;
      const excludeDomains = includeDomains
        ? undefined
        : exclude_domains ?? fallbackExclude;

      const response = await runExaSearch({
        query,
        numResults: num_results ?? maxResults,
        type,
        livecrawl,
        livecrawlTimeout: livecrawl_timeout_ms,
        textMaxCharacters: text_max_characters,
        highlightsNumSentences: highlights_num_sentences,
        highlightsPerUrl: highlights_per_url,
        includeDomains,
        excludeDomains,
      });

      return {
        requestId: response.requestId ?? "",
        searchType: response.searchType ?? "",
        results: (response.results ?? []).map((result) => ({
          title: result.title ?? "",
          url: result.url,
          publishedDate: result.publishedDate ?? "",
          author: result.author ?? "",
          text: result.text ?? "",
          highlights: Array.isArray(result.highlights) ? result.highlights : [],
        })),
        costDollars: response.costDollars ?? null,
      };
    },
  });
}
