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

type ExaContentsResponse = {
  requestId?: string;
  results?: ExaSearchResult[];
  statuses?: Array<{ id?: string; status?: string; error?: unknown }>;
  costDollars?: unknown;
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

async function runExaContents(input: {
  urls: string[];
  livecrawl?: "never" | "fallback" | "preferred" | "always";
  livecrawlTimeout?: number;
  textMaxCharacters?: number;
  highlightsNumSentences?: number;
  highlightsPerUrl?: number;
}): Promise<ExaContentsResponse> {
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

  const res = await fetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify({
      urls: input.urls,
      livecrawl: input.livecrawl ?? "preferred",
      ...(input.livecrawlTimeout
        ? { livecrawlTimeout: input.livecrawlTimeout }
        : {}),
      text: { maxCharacters: textMaxCharacters },
      highlights: {
        numSentences: highlightsNumSentences,
        highlightsPerUrl,
      },
    }),
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(
      `Exa contents failed: ${res.status} ${res.statusText} ${message}`.trim()
    );
  }

  return (await res.json()) as ExaContentsResponse;
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

      const results = (response.results ?? []).map((result) => ({
        title: result.title ?? "",
        url: result.url,
        id: result.id ?? "",
        publishedDate: result.publishedDate ?? "",
        author: result.author ?? "",
        text: result.text ?? "",
        highlights: Array.isArray(result.highlights) ? result.highlights : [],
      }));

      const missingUrls = results
        .filter(
          (result) =>
            result.url &&
            !result.text &&
            (!result.highlights || result.highlights.length === 0)
        )
        .map((result) => result.url);

      if (missingUrls.length > 0) {
        try {
          const contents = await runExaContents({
            urls: missingUrls,
            livecrawl,
            livecrawlTimeout: livecrawl_timeout_ms,
            textMaxCharacters: text_max_characters,
            highlightsNumSentences: highlights_num_sentences,
            highlightsPerUrl: highlights_per_url,
          });
          const contentByUrl = new Map(
            (contents.results ?? []).map((item) => [item.url, item])
          );
          for (const result of results) {
            if (result.text || result.highlights?.length) continue;
            const fallback = contentByUrl.get(result.url);
            if (!fallback) continue;
            result.text = fallback.text ?? result.text;
            result.highlights = Array.isArray(fallback.highlights)
              ? fallback.highlights
              : result.highlights;
            if (!result.title) result.title = fallback.title ?? "";
            if (!result.author) result.author = fallback.author ?? "";
            if (!result.publishedDate) {
              result.publishedDate = fallback.publishedDate ?? "";
            }
          }
        } catch {
          // Best-effort: if contents fetch fails, keep search results as-is.
        }
      }

      return {
        requestId: response.requestId ?? "",
        searchType: response.searchType ?? "",
        results,
        costDollars: response.costDollars ?? null,
      };
    },
  });
}
