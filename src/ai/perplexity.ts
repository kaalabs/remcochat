type PerplexitySearchSuccess = {
  id: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    date?: string;
    lastUpdated?: string;
  }>;
};

type PerplexitySearchError = {
  error: "api_error" | "rate_limit" | "timeout" | "invalid_input" | "unknown";
  statusCode?: number;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parsePerplexitySearchOutput(
  output: unknown
): PerplexitySearchSuccess | PerplexitySearchError | null {
  if (!isRecord(output)) return null;

  if (typeof output.message === "string" && typeof output.error === "string") {
    return output as PerplexitySearchError;
  }

  if (!Array.isArray(output.results) || typeof output.id !== "string") return null;

  const results: PerplexitySearchSuccess["results"] = [];
  for (const entry of output.results) {
    if (!isRecord(entry)) continue;
    const title = typeof entry.title === "string" ? entry.title : "";
    const url = typeof entry.url === "string" ? entry.url : "";
    const snippet = typeof entry.snippet === "string" ? entry.snippet : "";
    const date = typeof entry.date === "string" ? entry.date : undefined;
    const lastUpdated =
      typeof entry.lastUpdated === "string"
        ? entry.lastUpdated
        : typeof entry.last_updated === "string"
          ? entry.last_updated
          : undefined;
    if (!title || !url) continue;
    results.push({
      title,
      url,
      snippet,
      ...(date ? { date } : {}),
      ...(lastUpdated ? { lastUpdated } : {}),
    });
  }

  return {
    id: output.id as string,
    results,
  };
}

export function formatPerplexitySearchResultsForPrompt(
  output: unknown,
  options?: {
    maxResults?: number;
    maxSnippetChars?: number;
  }
): { ok: true; text: string } | { ok: false; errorText: string } {
  const parsed = parsePerplexitySearchOutput(output);
  if (!parsed) {
    return {
      ok: false,
      errorText: "Perplexity search returned an unknown response format.",
    };
  }

  if ("message" in parsed) {
    const status = typeof parsed.statusCode === "number" ? ` (${parsed.statusCode})` : "";
    return { ok: false, errorText: `${parsed.error}${status}: ${parsed.message}` };
  }

  const maxResults = Math.max(1, Math.min(10, Math.floor(options?.maxResults ?? 5)));
  const maxSnippetChars = Math.max(
    80,
    Math.min(1200, Math.floor(options?.maxSnippetChars ?? 420))
  );

  const lines: string[] = [];
  lines.push("Perplexity web search results:");

  const selected = parsed.results.slice(0, maxResults);
  for (const [index, r] of selected.entries()) {
    const snippet = (r.snippet ?? "").replace(/\s+/g, " ").trim();
    const clipped = snippet.length > maxSnippetChars ? `${snippet.slice(0, maxSnippetChars)}…` : snippet;
    lines.push(`${index + 1}. ${r.title}`);
    lines.push(`   URL: ${r.url}`);
    if (clipped) lines.push(`   Snippet: ${clipped}`);
  }

  if (selected.length === 0) {
    lines.push("(No results returned.)");
  }

  return { ok: true, text: lines.join("\n") };
}
