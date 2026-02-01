import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "remcochat-token-scan-"));
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function runTokenScan(args: string[], cwd: string) {
  const scriptPath = path.resolve(
    process.cwd(),
    "scripts",
    "verify-no-admin-token-in-logs.sh"
  );
  const res = spawnSync(scriptPath, args, { cwd, encoding: "utf8" });
  return {
    code: res.status ?? 0,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

test("verify-no-admin-token-in-logs passes when token is absent", () => {
  const dir = makeTempDir();
  const token = "x".repeat(64);
  const logPath = path.join(dir, "some.log");
  writeFile(logPath, "hello world\n");

  const res = runTokenScan(["--token", token, "--scan-file", logPath], dir);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /OK: no admin token found/i);
});

test("verify-no-admin-token-in-logs fails when token is present in a scanned file", () => {
  const dir = makeTempDir();
  const token = "x".repeat(64);
  const logPath = path.join(dir, "some.log");
  writeFile(logPath, `prefix ${token} suffix\n`);

  const res = runTokenScan(["--token", token, "--scan-file", logPath], dir);
  assert.notEqual(res.code, 0);
  assert.match(res.stdout, /FOUND token in file/i);
});

