import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createSkillsTools } from "../src/ai/skills-tools";
import { _resetConfigCacheForTests } from "../src/server/config";
import { _resetSkillsRegistryForTests } from "../src/server/skills/runtime";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;

function makeTempDir(prefix: string) {
  const dirPath = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function writeTempConfigToml(input: {
  skillsDir: string;
  maxSkillMdBytes: number;
  maxResourceBytes: number;
}) {
  const filePath = path.join(
    os.tmpdir(),
    `remcochat-config-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`
  );
  fs.writeFileSync(
    filePath,
    `
version = 2

[app]
default_provider_id = "vercel"

[app.skills]
enabled = true
directories = ["${input.skillsDir.replaceAll("\\", "\\\\")}"]
max_skill_md_bytes = ${input.maxSkillMdBytes}
max_resource_bytes = ${input.maxResourceBytes}

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`.trim() + "\n",
    "utf8"
  );
  return filePath;
}

function writeSkillFixture(input: {
  skillsRoot: string;
  skillName: string;
  skillBodyRepeat?: number;
}) {
  const dir = path.join(input.skillsRoot, input.skillName);
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });

  const repeat = Math.max(1, Math.floor(input.skillBodyRepeat ?? 200));
  const body = `# ${input.skillName}\n\n` + "x".repeat(repeat) + "\n";
  const skillMd = [
    "---",
    `name: ${input.skillName}`,
    "description: test skill fixture",
    "---",
    "",
    body,
  ].join("\n");
  fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd, "utf8");

  fs.writeFileSync(
    path.join(dir, "references", "REFERENCE.md"),
    "REMCOCHAT_SKILLS_CONFORMANCE_REFERENCE_v1\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "assets", "fixture.json"),
    JSON.stringify({ fixture_id: input.skillName }, null, 2) + "\n",
    "utf8"
  );

  return dir;
}

afterEach(() => {
  _resetSkillsRegistryForTests();
  _resetConfigCacheForTests();
  if (ORIGINAL_CONFIG_PATH === undefined) {
    delete process.env.REMCOCHAT_CONFIG_PATH;
  } else {
    process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
  }
});

test("skills.activate appends truncation notice when max_skill_md_bytes is exceeded", async () => {
  const skillsRoot = makeTempDir("remcochat-skills");
  writeSkillFixture({ skillsRoot, skillName: "my-skill", skillBodyRepeat: 5_000 });

  const cfgPath = writeTempConfigToml({
    skillsDir: skillsRoot,
    maxSkillMdBytes: 1_000,
    maxResourceBytes: 10_000,
  });
  process.env.REMCOCHAT_CONFIG_PATH = cfgPath;

  const tools = createSkillsTools({ enabled: true }).tools as Record<string, any>;
  const activate = tools["skillsActivate"];
  assert.ok(activate);

  const out = await activate.execute({ name: "my-skill" });
  assert.equal(out.name, "my-skill");
  assert.equal(out.frontmatter.name, "my-skill");
  assert.match(out.body, /\[REMCOCHAT_SKILLS_TRUNCATED: SKILL\.md; \d+ bytes removed\]$/);
});

test("skills.readResource rejects absolute paths and traversal", async () => {
  const skillsRoot = makeTempDir("remcochat-skills");
  writeSkillFixture({ skillsRoot, skillName: "my-skill" });

  const cfgPath = writeTempConfigToml({
    skillsDir: skillsRoot,
    maxSkillMdBytes: 10_000,
    maxResourceBytes: 10_000,
  });
  process.env.REMCOCHAT_CONFIG_PATH = cfgPath;

  const tools = createSkillsTools({ enabled: true }).tools as Record<string, any>;
  const read = tools["skillsReadResource"];
  assert.ok(read);

  await assert.rejects(
    () => read.execute({ name: "my-skill", path: "/etc/passwd" }),
    /Absolute paths are not allowed/
  );
  await assert.rejects(
    () => read.execute({ name: "my-skill", path: "../SKILL.md" }),
    /Path traversal is not allowed/
  );
  await assert.rejects(
    () =>
      read.execute({
        name: "my-skill",
        path: "references/../../../../etc/passwd",
      }),
    /Path traversal is not allowed/
  );
});

test("skills.readResource blocks symlink escape from skill root", async (t) => {
  const skillsRoot = makeTempDir("remcochat-skills");
  const skillDir = writeSkillFixture({ skillsRoot, skillName: "my-skill" });

  const outsideFile = path.join(skillsRoot, "outside.txt");
  fs.writeFileSync(outsideFile, "outside\n", "utf8");

  const escapeLink = path.join(skillDir, "references", "escape.txt");
  try {
    fs.symlinkSync(outsideFile, escapeLink);
  } catch (err) {
    const e = err as { code?: unknown };
    if (e && (e.code === "EPERM" || e.code === "EACCES")) {
      t.skip("Symlinks are not permitted on this platform/environment.");
      return;
    }
    throw err;
  }

  const cfgPath = writeTempConfigToml({
    skillsDir: skillsRoot,
    maxSkillMdBytes: 10_000,
    maxResourceBytes: 10_000,
  });
  process.env.REMCOCHAT_CONFIG_PATH = cfgPath;

  const tools = createSkillsTools({ enabled: true }).tools as Record<string, any>;
  const read = tools["skillsReadResource"];
  assert.ok(read);

  await assert.rejects(
    () => read.execute({ name: "my-skill", path: "references/escape.txt" }),
    /Access denied/
  );
});

test("skills.readResource appends truncation notice when max_resource_bytes is exceeded", async () => {
  const skillsRoot = makeTempDir("remcochat-skills");
  const skillDir = writeSkillFixture({ skillsRoot, skillName: "my-skill" });

  const big = "0123456789".repeat(200);
  fs.writeFileSync(path.join(skillDir, "references", "big.txt"), big, "utf8");

  const cfgPath = writeTempConfigToml({
    skillsDir: skillsRoot,
    maxSkillMdBytes: 10_000,
    maxResourceBytes: 1_000,
  });
  process.env.REMCOCHAT_CONFIG_PATH = cfgPath;

  const tools = createSkillsTools({ enabled: true }).tools as Record<string, any>;
  const read = tools["skillsReadResource"];
  assert.ok(read);

  const out = await read.execute({ name: "my-skill", path: "references/big.txt" });
  assert.equal(out.name, "my-skill");
  assert.equal(out.path, "references/big.txt");
  assert.match(
    out.content,
    /\[REMCOCHAT_SKILLS_TRUNCATED: resource; \d+ bytes removed\]$/
  );
});

test("skills.activate does not leak filesystem paths when SKILL.md is missing", async () => {
  const skillsRoot = makeTempDir("remcochat-skills");
  const skillDir = writeSkillFixture({ skillsRoot, skillName: "my-skill" });

  const cfgPath = writeTempConfigToml({
    skillsDir: skillsRoot,
    maxSkillMdBytes: 10_000,
    maxResourceBytes: 10_000,
  });
  process.env.REMCOCHAT_CONFIG_PATH = cfgPath;

  const tools = createSkillsTools({ enabled: true }).tools as Record<string, any>;
  const activate = tools["skillsActivate"];
  assert.ok(activate);

  await activate.execute({ name: "my-skill" });

  fs.rmSync(path.join(skillDir, "SKILL.md"), { force: true });

  await assert.rejects(
    () => activate.execute({ name: "my-skill" }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      assert.ok(!msg.includes(skillsRoot), "error message must not leak skill root path");
      assert.match(msg, /resource not found/i);
      return true;
    }
  );
});
