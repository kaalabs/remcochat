import assert from "node:assert/strict";
import { test } from "node:test";
import { computeOvNlRoutingPolicy } from "../src/server/ov/ov-nl-routing-policy";

test("computeOvNlRoutingPolicy allows OV when router confidence is high", () => {
  const policy = computeOvNlRoutingPolicy({
    routedIntent: { intent: "ov_nl", confidence: 0.95 },
  });
  assert.equal(policy.allowByRouter, true);
  assert.equal(policy.forceFastPath, true);
  assert.equal(policy.toolAllowedForPrompt, true);
});

test("computeOvNlRoutingPolicy allows OV tools but not fast-path when router confidence is below the OV min threshold", () => {
  const policy = computeOvNlRoutingPolicy({
    routedIntent: { intent: "ov_nl", confidence: 0.8 },
  });
  assert.equal(policy.allowByRouter, true);
  assert.equal(policy.forceFastPath, false);
  assert.equal(policy.toolAllowedForPrompt, true);
});

test("computeOvNlRoutingPolicy blocks OV when router intent is none", () => {
  const policy = computeOvNlRoutingPolicy({
    routedIntent: { intent: "none", confidence: 0.2 },
  });
  assert.equal(policy.allowByRouter, false);
  assert.equal(policy.forceFastPath, false);
  assert.equal(policy.toolAllowedForPrompt, false);
});

test("computeOvNlRoutingPolicy allows OV when explicitly invoked via skill", () => {
  const policy = computeOvNlRoutingPolicy({
    routedIntent: { intent: "none", confidence: 0.2 },
    explicitSkillName: "ov-nl-travel",
  });
  assert.equal(policy.skillForced, true);
  assert.equal(policy.forceFastPath, true);
  assert.equal(policy.toolAllowedForPrompt, true);
});

test("computeOvNlRoutingPolicy leaves prompt gating unset when router did not run", () => {
  const policy = computeOvNlRoutingPolicy({
    routedIntent: null,
  });
  assert.equal(policy.toolAllowedForPrompt, undefined);
});
