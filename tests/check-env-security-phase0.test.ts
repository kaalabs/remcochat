import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "remcochat-check-env-"));
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function runCheckEnv(opts: { cwd: string; env?: Record<string, string | undefined> }) {
  const scriptPath = path.resolve(process.cwd(), "scripts", "check-env.mjs");

  // Keep this environment intentionally minimal so the test doesn't pass/fail due
  // to the developer's shell state.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    USER: process.env.USER ?? "user",
    SHELL: process.env.SHELL ?? "/bin/sh",
    NODE_ENV: "development",
    ...Object.fromEntries(
      Object.entries(opts.env ?? {}).map(([k, v]) => [k, String(v ?? "")])
    ),
  };

  const res = spawnSync(process.execPath, [scriptPath], {
    cwd: opts.cwd,
    env,
    encoding: "utf8",
  });

  return {
    code: res.status ?? 0,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

function minimalDevConfigToml(input: { bashAccess: "localhost" | "lan" }) {
  // Dev LLM provider is opencode; phase0 security checks we care about are enforced
  // in scripts/check-env.mjs when bash tools are enabled.
  return `
version = 2

[app]
default_provider_id = "opencode"

[app.router]
enabled = false

[app.bash_tools]
enabled = true
provider = "docker"
access = "${input.bashAccess}"

[app.bash_tools.docker]
orchestrator_url = "http://127.0.0.1:8080"
network_mode = "default"
memory_mb = 2048

[app.bash_tools.seed]
mode = "git"
git_url = "https://example.com/repo.git"

[providers.opencode]
name = "OpenCode Zen"
api_key_env = "OPENCODE_API_KEY"
base_url = "https://example.com/zen/v1"
default_model_id = "kimi-k2.5-free"
allowed_model_ids = ["kimi-k2.5-free"]
`.trimStart();
}

test("check-env (phase0/dev): access=localhost does not require REMCOCHAT_ADMIN_TOKEN", () => {
  const dir = makeTempDir();
  writeFile(path.join(dir, "config.toml"), minimalDevConfigToml({ bashAccess: "localhost" }));

  const res = runCheckEnv({
    cwd: dir,
    env: {
      OPENCODE_API_KEY: "test-key",
      REMCOCHAT_ENABLE_BASH_TOOL: "1",
      // No REMCOCHAT_ADMIN_TOKEN on purpose.
    },
  });

  assert.equal(res.code, 0, res.stderr || res.stdout);
});

test("check-env (phase0/dev): access=lan rejects missing REMCOCHAT_ADMIN_TOKEN", () => {
  const dir = makeTempDir();
  writeFile(path.join(dir, "config.toml"), minimalDevConfigToml({ bashAccess: "lan" }));

  const res = runCheckEnv({
    cwd: dir,
    env: {
      OPENCODE_API_KEY: "test-key",
      REMCOCHAT_ENABLE_BASH_TOOL: "1",
      // No REMCOCHAT_ADMIN_TOKEN on purpose.
    },
  });

  assert.equal(res.code, 1);
  assert.match(res.stderr, /LAN access/i);
  assert.match(res.stderr, /REMCOCHAT_ADMIN_TOKEN is missing/i);
});

test("check-env (phase0/dev): access=lan rejects short REMCOCHAT_ADMIN_TOKEN", () => {
  const dir = makeTempDir();
  writeFile(path.join(dir, "config.toml"), minimalDevConfigToml({ bashAccess: "lan" }));

  const res = runCheckEnv({
    cwd: dir,
    env: {
      OPENCODE_API_KEY: "test-key",
      REMCOCHAT_ENABLE_BASH_TOOL: "1",
      REMCOCHAT_ADMIN_TOKEN: "short",
    },
  });

  assert.equal(res.code, 1);
  assert.match(res.stderr, /looks too short/i);
});

test("check-env (phase0/dev): access=lan accepts long REMCOCHAT_ADMIN_TOKEN", () => {
  const dir = makeTempDir();
  writeFile(path.join(dir, "config.toml"), minimalDevConfigToml({ bashAccess: "lan" }));

  const res = runCheckEnv({
    cwd: dir,
    env: {
      OPENCODE_API_KEY: "test-key",
      REMCOCHAT_ENABLE_BASH_TOOL: "1",
      REMCOCHAT_ADMIN_TOKEN: "x".repeat(64),
    },
  });

  assert.equal(res.code, 0, res.stderr || res.stdout);
});
