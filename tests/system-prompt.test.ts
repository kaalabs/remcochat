import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../src/ai/system-prompt";

test("includes explicit web tool guidance when enabled", () => {
  const prompt = buildSystemPrompt({
    profileInstructions: "",
    profileInstructionsRevision: 1,
    chatInstructions: "",
    chatInstructionsRevision: 1,
    memoryLines: [],
    isTemporary: false,
    toolsEnabled: true,
    webToolsEnabled: true,
    bashToolsEnabled: false,
  });

  assert.match(prompt, /Web tools are enabled for this chat\./);
  assert.match(prompt, /\bperplexity_search\b/);
  assert.match(prompt, /\bweb_search\b/);
  assert.match(prompt, /\bweb_fetch\b/);
  assert.match(prompt, /\bgoogle_search\b/);
  assert.match(prompt, /\burl_context\b/);
});

test("omits web tool guidance when disabled", () => {
  const prompt = buildSystemPrompt({
    profileInstructions: "",
    profileInstructionsRevision: 1,
    chatInstructions: "",
    chatInstructionsRevision: 1,
    memoryLines: [],
    isTemporary: false,
    toolsEnabled: true,
    webToolsEnabled: false,
    bashToolsEnabled: false,
  });

  assert.doesNotMatch(prompt, /Web tools are enabled for this chat\./);
});

test("includes explicit bash tool guidance when enabled", () => {
  const prompt = buildSystemPrompt({
    profileInstructions: "",
    profileInstructionsRevision: 1,
    chatInstructions: "",
    chatInstructionsRevision: 1,
    memoryLines: [],
    isTemporary: false,
    toolsEnabled: true,
    webToolsEnabled: false,
    bashToolsEnabled: true,
  });

  assert.match(prompt, /Bash tools are enabled for this chat\./);
  assert.match(prompt, /\bTools you may use: bash\b/);
  assert.match(prompt, /\breadFile\b/);
  assert.match(prompt, /\bwriteFile\b/);
  assert.match(prompt, /\bsandboxUrl\b/);
});

test("omits bash tool guidance when disabled", () => {
  const prompt = buildSystemPrompt({
    profileInstructions: "",
    profileInstructionsRevision: 1,
    chatInstructions: "",
    chatInstructionsRevision: 1,
    memoryLines: [],
    isTemporary: false,
    toolsEnabled: true,
    webToolsEnabled: false,
    bashToolsEnabled: false,
  });

  assert.doesNotMatch(prompt, /Bash tools are enabled for this chat\./);
});
