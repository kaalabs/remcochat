import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRunSkillsToolsSmokeTest } from "../src/server/chat/skills-smoke-test";

test("shouldRunSkillsToolsSmokeTest: matches the explicit validation skill flow", () => {
  assert.equal(
    shouldRunSkillsToolsSmokeTest({
      explicitSkillName: "skills-system-validation",
      lastUserText: "/skills-system-validation run skillsActivate then skillsReadResource",
      toolsEnabled: true,
    }),
    true,
  );
});

test("shouldRunSkillsToolsSmokeTest: requires both tool names in the request", () => {
  assert.equal(
    shouldRunSkillsToolsSmokeTest({
      explicitSkillName: "skills-system-validation",
      lastUserText: "/skills-system-validation run skillsActivate only",
      toolsEnabled: true,
    }),
    false,
  );
});

test("shouldRunSkillsToolsSmokeTest: rejects other skills and disabled tools", () => {
  assert.equal(
    shouldRunSkillsToolsSmokeTest({
      explicitSkillName: "hue-instant-control",
      lastUserText: "run skillsActivate and skillsReadResource",
      toolsEnabled: true,
    }),
    false,
  );
  assert.equal(
    shouldRunSkillsToolsSmokeTest({
      explicitSkillName: "skills-system-validation",
      lastUserText: "run skillsActivate and skillsReadResource",
      toolsEnabled: false,
    }),
    false,
  );
});
