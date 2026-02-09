import { tool as createTool } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  extra_snippets?: string[];
};

type BraveWebSearchResponse = {
  web?: {
    results?: BraveWebResult[];
  };
};

function getBraveApiKey() {
  const key = String(
    process.env.BRAVE_SEARCH_API ?? process.env.BRAVE_API_KEY ?? ""
  ).trim();
  if (!key) {
    throw new Error(
      "Missing Brave API key. Set BRAVE_SEARCH_API (preferred) or BRAVE_API_KEY."
    );
  }
  return key;
}

function mapFreshness(value: "day" | "week" | "month" | "year" | undefined) {
  if (!value) return undefined;
  if (value === "day") return "pd";
  if (value === "week") return "pw";
  if (value === "month") return "pm";
  return "py";
}

function normalizeDomain(value: string): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^\.+|\.+$/g, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0]!.replace(/^\.+|\.+$/g, "");
  }
}

function hostnameFromUrl(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostMatchesDomain(hostname: string, domain: string) {
  if (!hostname || !domain) return false;
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function includeByDomain(hostname: string, includeDomains: string[] | undefined) {
  if (!includeDomains || includeDomains.length === 0) return true;
  return includeDomains.some((domain) => hostMatchesDomain(hostname, domain));
}

function excludeByDomain(hostname: string, excludeDomains: string[] | undefined) {
  if (!excludeDomains || excludeDomains.length === 0) return false;
  return excludeDomains.some((domain) => hostMatchesDomain(hostname, domain));
}

async function runBraveSearch(input: {
  query: string;
  count: number;
  freshness?: "day" | "week" | "month" | "year";
  country?: string;
  searchLang?: string;
}): Promise<BraveWebSearchResponse> {
  const key = getBraveApiKey();
  const params = new URLSearchParams({
    q: input.query,
    count: String(input.count),
    result_filter: "web",
    extra_snippets: "true",
  });

  const mappedFreshness = mapFreshness(input.freshness);
  if (mappedFreshness) params.set("freshness", mappedFreshness);
  if (input.country) params.set("country", input.country);
  if (input.searchLang) params.set("search_lang", input.searchLang);

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
  });

  if (!res.ok) {
    const body = String(await res.text()).slice(0, 600).trim();
    if (res.status === 429) {
      const retryAfter = String(res.headers.get("retry-after") ?? "").trim();
      const limit = String(res.headers.get("x-ratelimit-limit") ?? "").trim();
      const remaining = String(res.headers.get("x-ratelimit-remaining") ?? "").trim();
      const reset = String(res.headers.get("x-ratelimit-reset") ?? "").trim();
      throw new Error(
        [
          `Brave search failed: ${res.status} ${res.statusText}`.trim(),
          retryAfter ? `retry-after=${retryAfter}` : "",
          limit ? `x-ratelimit-limit=${limit}` : "",
          remaining ? `x-ratelimit-remaining=${remaining}` : "",
          reset ? `x-ratelimit-reset=${reset}` : "",
          body,
        ]
          .filter(Boolean)
          .join(" ")
      );
    }
    throw new Error(`Brave search failed: ${res.status} ${res.statusText} ${body}`.trim());
  }

  return (await res.json()) as BraveWebSearchResponse;
}

export function createBraveSearchTool() {
  return createTool({
    description:
      "Search the web with Brave Search and return compact, citation-friendly web results.",
    inputSchema: z.object({
      query: z.string().describe("The search query."),
      num_results: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of results to return."),
      freshness: z.enum(["day", "week", "month", "year"]).optional(),
      include_domains: z
        .array(z.string())
        .optional()
        .describe("Restrict results to these domains."),
      exclude_domains: z
        .array(z.string())
        .optional()
        .describe("Exclude results from these domains."),
      country: z
        .string()
        .min(2)
        .max(8)
        .optional()
        .describe("Optional country code for localization (for example: US, NL)."),
      search_lang: z
        .string()
        .min(2)
        .max(8)
        .optional()
        .describe("Optional search language code (for example: en, nl)."),
    }),
    execute: async ({
      query,
      num_results,
      freshness,
      include_domains,
      exclude_domains,
      country,
      search_lang,
    }) => {
      const config = getConfig().webTools;
      const maxResults = config?.maxResults ?? 8;
      const count = Math.max(1, Math.min(20, Math.floor(num_results ?? maxResults)));
      const effectiveFreshness = freshness ?? config?.recency ?? undefined;

      const fallbackInclude =
        config && config.allowedDomains.length > 0 ? config.allowedDomains : undefined;
      const fallbackExclude =
        config && config.blockedDomains.length > 0 ? config.blockedDomains : undefined;

      const includeDomainsRaw = include_domains ?? fallbackInclude;
      const excludeDomainsRaw = includeDomainsRaw
        ? undefined
        : exclude_domains ?? fallbackExclude;

      const includeDomains = includeDomainsRaw
        ?.map((d) => normalizeDomain(d))
        .filter(Boolean);
      const excludeDomains = excludeDomainsRaw
        ?.map((d) => normalizeDomain(d))
        .filter(Boolean);

      const response = await runBraveSearch({
        query,
        count,
        freshness: effectiveFreshness,
        country: String(country ?? "").trim() || undefined,
        searchLang: String(search_lang ?? "").trim() || undefined,
      });

      const normalized = (response.web?.results ?? [])
        .map((result) => {
          const url = String(result.url ?? "").trim();
          if (!url) return null;
          const hostname = hostnameFromUrl(url);
          if (!includeByDomain(hostname, includeDomains)) return null;
          if (excludeByDomain(hostname, excludeDomains)) return null;
          return {
            title: String(result.title ?? "").trim(),
            url,
            description: String(result.description ?? "").trim(),
            age: String(result.age ?? "").trim(),
            extraSnippets: Array.isArray(result.extra_snippets)
              ? result.extra_snippets
                  .map((s) => String(s ?? "").trim())
                  .filter(Boolean)
                  .slice(0, 5)
              : [],
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .slice(0, count);

      return {
        provider: "brave",
        results: normalized,
      };
    },
  });
}
