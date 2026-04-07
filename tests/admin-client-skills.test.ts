import assert from "node:assert/strict";
import test from "node:test";

import { summarizeAdminSkills } from "../src/app/admin/admin-client-skills";
import {
  getAdminSkillActivatedCount,
  shouldShowAdminSkillReadinessDot,
} from "../src/app/admin/admin-client-skills-card";
import type { SkillsAdminResponse } from "../src/app/admin/admin-client-api";

test("summarizeAdminSkills returns null when no skills payload is loaded", () => {
  assert.equal(summarizeAdminSkills(null), null);
});

test("summarizeAdminSkills derives the admin summary counts and scan metadata", () => {
  const scannedAt = Date.UTC(2026, 2, 26, 12, 30, 0);
  const skills: SkillsAdminResponse = {
    enabled: true,
    scannedAt,
    scanRoots: ["/repo/.skills"],
    scanRootsMeta: [{ root: "/repo/.skills", exists: true, skillsCount: 2 }],
    skills: [
      {
        name: "alpha",
        description: "First skill",
        detectedTools: ["hueGateway"],
      },
      {
        name: "beta",
        description: "Second skill",
      },
    ],
    invalid: [{ skillDir: "/bad", skillMdPath: "/bad/SKILL.md", error: "bad" }],
    collisions: [
      {
        name: "alpha",
        winner: {
          sourceDir: "/repo/.skills",
          skillDir: "/repo/.skills/alpha",
          skillMdPath: "/repo/.skills/alpha/SKILL.md",
        },
        losers: [
          {
            sourceDir: "/tmp/alpha",
            skillDir: "/tmp/alpha",
            skillMdPath: "/tmp/alpha/SKILL.md",
          },
        ],
      },
    ],
    usage: {
      chatsWithAnyActivatedSkills: 1,
      activatedSkillCounts: { alpha: 3 },
    },
  };

  const summary = summarizeAdminSkills(skills);

  assert.deepEqual(summary, {
    activatedCounts: { alpha: 3 },
    collisions: 1,
    discovered: 2,
    enabled: true,
    invalid: 1,
    scanRoots: ["/repo/.skills"],
    scanRootsMeta: [{ root: "/repo/.skills", exists: true, skillsCount: 2 }],
    scannedAt: new Date(scannedAt),
  });
});

test("shouldShowAdminSkillReadinessDot only shows for tool-tied applicable skills", () => {
  assert.equal(
    shouldShowAdminSkillReadinessDot({
      detectedTools: ["hueGateway"],
      readinessState: "untested",
    }),
    true
  );
  assert.equal(
    shouldShowAdminSkillReadinessDot({
      detectedTools: [],
      readinessState: "untested",
    }),
    false
  );
  assert.equal(
    shouldShowAdminSkillReadinessDot({
      detectedTools: ["hueGateway"],
      readinessState: "not_applicable",
    }),
    false
  );
});

test("getAdminSkillActivatedCount falls back to zero for unseen skills", () => {
  const summary = summarizeAdminSkills({
    enabled: true,
    usage: {
      chatsWithAnyActivatedSkills: 1,
      activatedSkillCounts: { alpha: 2 },
    },
  });

  assert.ok(summary);
  assert.equal(
    getAdminSkillActivatedCount({ skillName: "alpha", skillsSummary: summary }),
    2
  );
  assert.equal(
    getAdminSkillActivatedCount({ skillName: "beta", skillsSummary: summary }),
    0
  );
});
