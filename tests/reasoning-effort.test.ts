import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedReasoningEfforts,
  normalizeReasoningEffort,
} from "../src/lib/reasoning-effort";

test("allowedReasoningEfforts returns OpenAI set for openai_responses", () => {
  const options = allowedReasoningEfforts({ modelType: "openai_responses" });
  assert.deepEqual(options, ["minimal", "low", "medium", "high"]);
});

test("allowedReasoningEfforts excludes minimal when web tools enabled", () => {
  const options = allowedReasoningEfforts({
    modelType: "openai_responses",
    webToolsEnabled: true,
  });
  assert.deepEqual(options, ["low", "medium", "high"]);
});

test("allowedReasoningEfforts returns standard set for anthropic", () => {
  const options = allowedReasoningEfforts({ modelType: "anthropic_messages" });
  assert.deepEqual(options, ["low", "medium", "high"]);
});

test("normalizeReasoningEffort keeps valid values", () => {
  const options = ["low", "medium", "high"] as const;
  assert.equal(normalizeReasoningEffort("low", [...options]), "low");
  assert.equal(normalizeReasoningEffort("AUTO", [...options]), "auto");
});

test("normalizeReasoningEffort falls back to auto", () => {
  const options = ["low", "medium", "high"] as const;
  assert.equal(normalizeReasoningEffort("minimal", [...options]), "auto");
  assert.equal(normalizeReasoningEffort("", [...options]), "auto");
});
