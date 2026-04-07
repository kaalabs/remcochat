import assert from "node:assert/strict";
import { test } from "node:test";
import { createToolBundle } from "../src/ai/tool-bundle";
import {
  formatAttachmentProcessingError,
  isPerplexitySearchEnabled,
} from "../src/server/chat/turn-response";

test("formatAttachmentProcessingError prefers error messages and falls back generically", () => {
  assert.equal(
    formatAttachmentProcessingError(new Error("attachment worker failed")),
    "Attachment processing error: attachment worker failed",
  );
  assert.equal(
    formatAttachmentProcessingError("boom"),
    "Attachment processing error.",
  );
});

test("isPerplexitySearchEnabled only enables continuation for the named web tool", () => {
  const enabledBundle = createToolBundle({
    enabled: true,
    entries: [],
  });
  enabledBundle.tools.perplexity_search = {};

  const disabledBundle = createToolBundle({
    enabled: true,
    entries: [],
  });
  disabledBundle.tools.exa_search = {};

  assert.equal(isPerplexitySearchEnabled(enabledBundle), true);
  assert.equal(isPerplexitySearchEnabled(disabledBundle), false);
});
