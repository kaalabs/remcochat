import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SkillRecord, SkillsRegistry } from "../src/server/skills/types";
import {
  buildExplicitSkillPromptSections,
  isExplicitOvNlSkillUnavailable,
  prepareChatSkillsContext,
} from "../src/server/chat/skills-context";
import { OV_NL_SKILL_NAME } from "../src/server/ov/ov-nl-constants";

function makeUserMessage(text: string) {
  return {
    id: "u1",
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  };
}

function makeRegistry(skills: SkillRecord[]): SkillsRegistry {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  return {
    snapshot() {
      return {
        enabled: true,
        scannedAt: 0,
        scanRoots: [],
        skills,
        invalid: [],
        collisions: [],
        warnings: [],
      };
    },
    get(name: string) {
      return byName.get(name) ?? null;
    },
    list() {
      return skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      }));
    },
  };
}

test("prepareChatSkillsContext filters disabled OV skill but keeps other explicit skills", () => {
  const registry = makeRegistry([
    {
      name: OV_NL_SKILL_NAME,
      description: "OV travel",
      skillDir: "/tmp/ov",
      skillMdPath: "/tmp/ov/SKILL.md",
      sourceDir: "/tmp/ov",
    },
    {
      name: "skills-system-validation",
      description: "Validate skills tools",
      skillDir: "/tmp/skills-system-validation",
      skillMdPath: "/tmp/skills-system-validation/SKILL.md",
      sourceDir: "/tmp/skills-system-validation",
    },
  ]);

  const result = prepareChatSkillsContext({
    messages: [makeUserMessage("/skills-system-validation run checks")],
    skillsRegistry: registry,
    ovNlToolsEnabled: false,
  });

  assert.deepEqual(
    result.availableSkills.map((skill) => skill.name),
    ["skills-system-validation"],
  );
  assert.equal(result.skillInvocation.explicitSkillName, "skills-system-validation");
  const part = result.skillInvocation.messages[0]?.parts[0];
  assert.equal(part?.type, "text");
  assert.equal(part && "text" in part ? part.text : "", "run checks");
  assert.equal(result.explicitSkillActivationOnly, false);
});

test("isExplicitOvNlSkillUnavailable requires installed OV skill and disabled OV tools", () => {
  const registry = makeRegistry([
    {
      name: OV_NL_SKILL_NAME,
      description: "OV travel",
      skillDir: "/tmp/ov",
      skillMdPath: "/tmp/ov/SKILL.md",
      sourceDir: "/tmp/ov",
    },
  ]);

  assert.equal(
    isExplicitOvNlSkillUnavailable({
      explicitSkillCandidate: OV_NL_SKILL_NAME,
      skillsRegistry: registry,
      ovNlToolsEnabled: false,
    }),
    true,
  );
  assert.equal(
    isExplicitOvNlSkillUnavailable({
      explicitSkillCandidate: OV_NL_SKILL_NAME,
      skillsRegistry: registry,
      ovNlToolsEnabled: true,
    }),
    false,
  );
  assert.equal(
    isExplicitOvNlSkillUnavailable({
      explicitSkillCandidate: OV_NL_SKILL_NAME,
      skillsRegistry: null,
      ovNlToolsEnabled: false,
    }),
    false,
  );
});

test("buildExplicitSkillPromptSections injects activation guidance and SKILL.md fallback", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remcochat-chat-skills-context-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const skillDir = path.join(dir, "skills-system-validation");
  fs.mkdirSync(skillDir, { recursive: true });
  const skillMdPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillMdPath, "# Skill\n\nFollow the checklist.\n", "utf8");

  const registry = makeRegistry([
    {
      name: "skills-system-validation",
      description: "Validate skills tools",
      skillDir,
      skillMdPath,
      sourceDir: skillDir,
    },
  ]);

  const sections = buildExplicitSkillPromptSections({
    explicitSkillName: "skills-system-validation",
    skillsRegistry: registry,
    toolsEnabled: false,
    maxSkillMdBytes: 10_000,
  });

  assert.equal(sections.length, 2);
  assert.match(sections[0] ?? "", /Explicit skill invocation detected/);
  assert.match(sections[0] ?? "", /Call skillsActivate first/);
  assert.match(sections[1] ?? "", /Tool calling is unavailable for this model/);
  assert.match(sections[1] ?? "", /# Skill/);
  assert.match(sections[1] ?? "", /Follow the checklist\./);
});
