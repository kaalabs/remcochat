import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { _resetConfigCacheForTests, getConfig } from "../src/server/config";
import { discoverSkills } from "../src/server/skills/registry";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;

const tempDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeTempConfigToml(content: string) {
  const filePath = path.join(
    os.tmpdir(),
    `remcochat-config-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`
  );
  fs.writeFileSync(filePath, content, "utf8");
  tempDirs.push(filePath);
  return filePath;
}

function writeSkill(skillDir: string, content: string) {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
}

function findIndexByRealpath(paths: string[], target: string) {
  const targetReal = fs.realpathSync(target);
  return paths.findIndex((p) => {
    try {
      return fs.realpathSync(p) === targetReal;
    } catch {
      return false;
    }
  });
}

afterEach(() => {
  _resetConfigCacheForTests();
  process.chdir(ORIGINAL_CWD);

  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;

  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.REMCOCHAT_CONFIG_PATH;
  else process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;

  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

test("discovers .agents/skills up the tree + global ~/.agents/skills", () => {
  const base = makeTempDir("remcochat-skills-dotagents-");
  const parentAgentsSkills = path.join(base, ".agents", "skills");
  const childProject = path.join(base, "project");
  const childAgentsSkills = path.join(childProject, ".agents", "skills");
  const nestedCwd = path.join(childProject, "apps", "web");

  const fakeHome = makeTempDir("remcochat-fake-home-");
  const globalAgentsSkills = path.join(fakeHome, ".agents", "skills");

  process.env.HOME = fakeHome;
  fs.mkdirSync(nestedCwd, { recursive: true });
  process.chdir(nestedCwd);

  writeSkill(
    path.join(parentAgentsSkills, "parent-skill"),
    `---\nname: parent-skill\ndescription: from parent\n---\n\n# Parent\n`
  );
  writeSkill(
    path.join(childAgentsSkills, "child-skill"),
    `---\nname: child-skill\ndescription: from child\n---\n\n# Child\n`
  );
  writeSkill(
    path.join(globalAgentsSkills, "global-skill"),
    `---\nname: global-skill\ndescription: from global\n---\n\n# Global\n`
  );

  writeSkill(
    path.join(parentAgentsSkills, "shared-skill"),
    `---\nname: shared-skill\ndescription: from parent\n---\n\n# Shared Parent\n`
  );
  writeSkill(
    path.join(childAgentsSkills, "shared-skill"),
    `---\nname: shared-skill\ndescription: from child\n---\n\n# Shared Child\n`
  );

  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.skills]
enabled = true

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;

  _resetConfigCacheForTests();
  const cfg = getConfig();
  assert.ok(cfg.skills);

  const dirs = cfg.skills.directories;
  const idxChild = findIndexByRealpath(dirs, childAgentsSkills);
  const idxParent = findIndexByRealpath(dirs, parentAgentsSkills);
  const idxGlobal = findIndexByRealpath(dirs, globalAgentsSkills);

  assert.ok(idxChild >= 0, "expected child .agents/skills directory in scan roots");
  assert.ok(idxParent >= 0, "expected parent .agents/skills directory in scan roots");
  assert.ok(idxGlobal >= 0, "expected global ~/.agents/skills directory in scan roots");
  assert.ok(idxChild < idxParent, "expected child .agents/skills to precede parent");
  assert.ok(idxParent < idxGlobal, "expected parent .agents/skills to precede global");

  const res = discoverSkills({ scanRoots: dirs, maxSkills: 200 });

  assert.ok(res.skills.some((s) => s.name === "child-skill"));
  assert.ok(res.skills.some((s) => s.name === "parent-skill"));
  assert.ok(res.skills.some((s) => s.name === "global-skill"));

  const shared = res.skills.find((s) => s.name === "shared-skill");
  assert.ok(shared);
  assert.equal(shared.description, "from child");
});
