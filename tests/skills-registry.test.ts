import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { discoverSkills } from "../src/server/skills/registry";

const tempDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(skillDir: string, content: string) {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

test("discovers repo skills in .skills", () => {
  const res = discoverSkills({
    scanRoots: [path.resolve(".skills")],
    maxSkills: 200,
  });

  assert.ok(res.skills.some((s) => s.name === "skills-system-validation"));
  assert.ok(res.skills.some((s) => s.name === "hue-instant-control"));
  assert.ok(res.skills.some((s) => s.name === "ov-nl-travel"));
  assert.deepEqual(res.invalid, []);
});

test("excludes invalid skills and records errors", () => {
  const root = makeTempDir("remcochat-skills-registry-");
  writeSkill(
    path.join(root, "BadSkill"),
    `---\nname: BadSkill\ndescription: Invalid because uppercase\n---\n\n# Bad\n`
  );

  const res = discoverSkills({ scanRoots: [root], maxSkills: 200 });
  assert.equal(res.skills.length, 0);
  assert.equal(res.invalid.length, 1);
  assert.match(res.invalid[0]?.error ?? "", /name/i);
});

test("collision precedence: first scan root wins and later roots are recorded as losers", () => {
  const rootA = makeTempDir("remcochat-skills-collide-a-");
  const rootB = makeTempDir("remcochat-skills-collide-b-");

  writeSkill(
    path.join(rootA, "collide-skill"),
    `---\nname: collide-skill\ndescription: winner\n---\n\n# Winner\n`
  );
  writeSkill(
    path.join(rootB, "collide-skill"),
    `---\nname: collide-skill\ndescription: loser\n---\n\n# Loser\n`
  );

  const res = discoverSkills({ scanRoots: [rootA, rootB], maxSkills: 200 });

  assert.equal(res.skills.length, 1);
  assert.equal(res.skills[0]?.name, "collide-skill");
  assert.equal(res.skills[0]?.description, "winner");

  assert.equal(res.collisions.length, 1);
  const collision = res.collisions[0];
  assert.ok(collision);
  assert.equal(collision.name, "collide-skill");
  assert.equal(collision.winner.description, "winner");
  assert.equal(collision.losers.length, 1);
  assert.equal(collision.losers[0]?.description, "loser");
  assert.equal(collision.losers[0]?.sourceDir, rootB.replace(/\/+$/, ""));
});
