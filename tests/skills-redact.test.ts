import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { redactSkillsRegistrySnapshotForPublic } from "../src/server/skills/redact";
import type { SkillsRegistrySnapshot } from "../src/server/skills/types";

test("redacts filesystem paths for public skills snapshot", () => {
  const cwd = path.resolve(process.cwd());
  const home = path.resolve(os.homedir());

  const snapshot: SkillsRegistrySnapshot = {
    enabled: true,
    scannedAt: Date.now(),
    scanRoots: [cwd, path.join(home, ".remcochat", "skills"), "/etc/does-not-exist"],
    skills: [
      {
        name: "example-skill",
        description: "Example",
        skillDir: path.join(cwd, ".skills", "example-skill"),
        skillMdPath: path.join(cwd, ".skills", "example-skill", "SKILL.md"),
        sourceDir: cwd,
      },
    ],
    invalid: [
      {
        skillDir: "/etc/example-skill",
        skillMdPath: "/etc/example-skill/SKILL.md",
        error: "Invalid skill",
      },
    ],
    collisions: [
      {
        name: "example-skill",
        winner: {
          name: "example-skill",
          description: "Winner",
          skillDir: path.join(cwd, ".skills", "example-skill"),
          skillMdPath: path.join(cwd, ".skills", "example-skill", "SKILL.md"),
          sourceDir: cwd,
        },
        losers: [
          {
            name: "example-skill",
            description: "Loser",
            skillDir: "/private/tmp/example-skill",
            skillMdPath: "/private/tmp/example-skill/SKILL.md",
            sourceDir: "/private/tmp",
          },
        ],
      },
    ],
    warnings: [
      `Skills scan root missing: ${cwd}`,
      `Skills scan root missing: ${home}`,
      `Skills scan root missing: /etc/does-not-exist`,
    ],
  };

  const redacted = redactSkillsRegistrySnapshotForPublic(snapshot);

  assert.equal(redacted.enabled, true);
  assert.equal(redacted.skills[0]?.name, "example-skill");

  const scanRootsText = redacted.scanRoots.join("\n");
  assert.ok(!scanRootsText.includes(cwd));
  assert.ok(!scanRootsText.includes(home));

  const skill = redacted.skills[0]!;
  assert.ok(skill.skillDir.startsWith("./"));
  assert.ok(skill.skillMdPath.startsWith("./"));
  assert.equal(skill.sourceDir, ".");

  const invalid = redacted.invalid[0]!;
  assert.equal(invalid.skillDir, "<redacted>");
  assert.equal(invalid.skillMdPath, "<redacted>");

  const loser = redacted.collisions[0]!.losers[0]!;
  assert.equal(loser.skillDir, "<redacted>");
  assert.equal(loser.skillMdPath, "<redacted>");
  assert.equal(loser.sourceDir, "<redacted>");

  const warningsText = redacted.warnings.join("\n");
  assert.ok(!warningsText.includes(cwd));
  assert.ok(!warningsText.includes(home));
  assert.ok(!warningsText.includes("/etc/does-not-exist"));
});

