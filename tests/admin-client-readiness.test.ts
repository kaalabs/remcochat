import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAdminSkillPreflightState,
  resolveAdminReadinessStateFromStatus,
} from "../src/app/admin/admin-client-readiness";

test("resolveAdminReadinessStateFromStatus keeps allowed states and falls back otherwise", () => {
  assert.equal(
    resolveAdminReadinessStateFromStatus({
      allowedStates: ["passed", "disabled"],
      fallback: "failed",
      status: "passed",
    }),
    "passed"
  );
  assert.equal(
    resolveAdminReadinessStateFromStatus({
      allowedStates: ["passed", "disabled"],
      fallback: "failed",
      status: "disabled",
    }),
    "disabled"
  );
  assert.equal(
    resolveAdminReadinessStateFromStatus({
      allowedStates: ["passed", "disabled"],
      fallback: "failed",
      status: "unknown",
    }),
    "failed"
  );
});

test("classifyAdminSkillPreflightState reflects blocked and disabled tool dependencies", () => {
  const preflight = {
    webTools: { enabled: true },
    tools: {
      hueGateway: "enabled",
      ovNlGateway: "enabled",
    },
  } as const;

  assert.equal(
    classifyAdminSkillPreflightState({
      detectedTools: [],
      preflight,
    }),
    "untested"
  );
  assert.equal(
    classifyAdminSkillPreflightState({
      detectedTools: ["hueGateway"],
      preflight: {
        ...preflight,
        tools: { ...preflight.tools, hueGateway: "disabled" },
      },
    }),
    "disabled"
  );
  assert.equal(
    classifyAdminSkillPreflightState({
      detectedTools: ["ovNlGateway"],
      preflight: {
        ...preflight,
        tools: { ...preflight.tools, ovNlGateway: "blocked" },
      },
    }),
    "blocked"
  );
});
