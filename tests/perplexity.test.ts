import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPerplexitySearchResultsForPrompt } from "../src/ai/perplexity";

test("formatPerplexitySearchResultsForPrompt formats success output", () => {
  const output = {
    id: "test",
    results: [
      {
        title: "Example Result",
        url: "https://example.com",
        snippet: "This is a snippet about the page.",
        last_updated: "2026-01-01",
      },
    ],
  };

  const formatted = formatPerplexitySearchResultsForPrompt(output, {
    maxResults: 5,
    maxSnippetChars: 100,
  });

  assert.equal(formatted.ok, true);
  if (!formatted.ok) return;
  assert.match(formatted.text, /Perplexity web search results:/);
  assert.match(formatted.text, /Example Result/);
  assert.match(formatted.text, /https:\/\/example\.com/);
});

test("formatPerplexitySearchResultsForPrompt returns error for error output", () => {
  const formatted = formatPerplexitySearchResultsForPrompt({
    error: "rate_limit",
    statusCode: 429,
    message: "Too many requests",
  });

  assert.equal(formatted.ok, false);
  if (formatted.ok) return;
  assert.match(formatted.errorText, /rate_limit/);
});

test("formatPerplexitySearchResultsForPrompt returns error for unknown output", () => {
  const formatted = formatPerplexitySearchResultsForPrompt({ nope: true });
  assert.equal(formatted.ok, false);
});

