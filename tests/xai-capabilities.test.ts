import assert from "node:assert/strict";
import { test } from "node:test";
import { xaiReasoningEffortSupport } from "../src/lib/xai-capabilities";

test("xaiReasoningEffortSupport marks grok-4 as unsupported", () => {
  assert.equal(xaiReasoningEffortSupport("grok-4"), "unsupported");
});

test("xaiReasoningEffortSupport marks grok-4-1-fast as unsupported", () => {
  assert.equal(xaiReasoningEffortSupport("grok-4-1-fast"), "unsupported");
});

test("xaiReasoningEffortSupport marks reasoning variants as supported", () => {
  assert.equal(
    xaiReasoningEffortSupport("grok-4-fast-reasoning"),
    "supported"
  );
});

test("xaiReasoningEffortSupport marks grok-3-mini as supported", () => {
  assert.equal(xaiReasoningEffortSupport("grok-3-mini"), "supported");
});

test("xaiReasoningEffortSupport keeps unknown models as unknown", () => {
  assert.equal(
    xaiReasoningEffortSupport("grok-future-ultra-1"),
    "unknown"
  );
});
