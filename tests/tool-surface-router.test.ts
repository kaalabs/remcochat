import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inferFallbackToolSurface,
  TOOL_SURFACE_ROUTER_PROMPT,
  normalizeToolSurfaceConfidence,
  resolveToolSurfaceDecision,
  toolSurfaceFromIntentRoute,
} from "../src/server/tool-surface-router";

test("tool-surface router prompt explicitly covers multilingual execution routing", () => {
  assert.match(TOOL_SURFACE_ROUTER_PROMPT, /may be in any language/i);
  assert.match(
    TOOL_SURFACE_ROUTER_PROMPT,
    /"voer een hello-world python programma uit" -> workspace_exec/i,
  );
  assert.match(TOOL_SURFACE_ROUTER_PROMPT, /"run a hello world python program" -> workspace_exec/i);
  assert.match(TOOL_SURFACE_ROUTER_PROMPT, /Classify based on meaning, not keyword matching/i);
});

test("tool-surface decision prefers explicit routed surface", () => {
  const surface = resolveToolSurfaceDecision({
    routedToolSurface: { surface: "workspace_exec", confidence: 0.96 },
    routedIntent: { intent: "agenda", confidence: 0.98 },
    lastUserText: "show my agenda",
  });

  assert.equal(surface, "workspace_exec");
});

test("tool-surface confidence normalization tolerates model outputs without confidence", () => {
  assert.equal(
    normalizeToolSurfaceConfidence({ surface: "workspace_exec" }),
    1,
  );
  assert.equal(
    normalizeToolSurfaceConfidence({ surface: "none" }),
    0,
  );
  assert.equal(
    normalizeToolSurfaceConfidence({ surface: "web", confidence: 1.4 }),
    1,
  );
});

test("fallback routing detects multilingual workspace execution intent", () => {
  assert.equal(
    inferFallbackToolSurface("voer een hello-world python programma uit"),
    "workspace_exec",
  );
  assert.equal(
    inferFallbackToolSurface("run a hello world python program"),
    "workspace_exec",
  );
});

test("tool-surface decision falls back to intent routing when the surface router returns none", () => {
  const surface = resolveToolSurfaceDecision({
    routedToolSurface: { surface: "none", confidence: 0.2 },
    routedIntent: { intent: "weather_forecast", confidence: 0.93, location: "Amsterdam" },
    lastUserText: "weather forecast",
  });

  assert.equal(surface, "display_weather_forecast");
});

test("tool-surface decision keeps OV and Hue policy overrides authoritative", () => {
  assert.equal(
    resolveToolSurfaceDecision({
      routedToolSurface: { surface: "workspace_exec", confidence: 0.91 },
      routedIntent: { intent: "none", confidence: 0.1 },
      lastUserText: "show departures",
      forceOvNlTool: true,
    }),
    "ov_nl",
  );

  assert.equal(
    resolveToolSurfaceDecision({
      routedToolSurface: { surface: "web", confidence: 0.88 },
      routedIntent: { intent: "none", confidence: 0.2 },
      lastUserText: "turn the lights off",
      hueSkillRelevant: true,
    }),
    "hue",
  );
});

test("tool-surface decision falls back to deterministic execution routing when the router is unavailable", () => {
  const surface = resolveToolSurfaceDecision({
    routedToolSurface: null,
    routedIntent: { intent: "none", confidence: 0 },
    lastUserText: "voer een hello-world python programma uit",
  });

  assert.equal(surface, "workspace_exec");
});

test("intent routing maps only the supported fast-path intents to tool surfaces", () => {
  assert.equal(
    toolSurfaceFromIntentRoute({ intent: "weather_current", confidence: 0.91, location: "Utrecht" }),
    "display_weather",
  );
  assert.equal(
    toolSurfaceFromIntentRoute({ intent: "agenda", confidence: 0.9 }),
    "display_agenda",
  );
  assert.equal(toolSurfaceFromIntentRoute({ intent: "memory_add", confidence: 0.9, memoryCandidate: "x" }), null);
});
