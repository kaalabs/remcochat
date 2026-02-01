import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "remcochat-proxy-certs-"));
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function runCheckProxyCerts(args: string[], cwd: string) {
  const scriptPath = path.resolve(process.cwd(), "scripts", "check-proxy-certs.sh");
  const res = spawnSync(scriptPath, args, {
    cwd,
    encoding: "utf8",
  });
  return {
    code: res.status ?? 0,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

test("check-proxy-certs rejects missing files", () => {
  const dir = makeTempDir();
  const certDir = path.join(dir, "nginx", "certs");
  fs.mkdirSync(certDir, { recursive: true });

  // Only one file present; the rest should fail.
  writeFile(path.join(certDir, "tls.pem"), "dummy");

  const res = runCheckProxyCerts(["--cert-dir", certDir], dir);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /Missing required proxy cert files/i);
});

test("check-proxy-certs rejects empty files", () => {
  const dir = makeTempDir();
  const certDir = path.join(dir, "nginx", "certs");
  fs.mkdirSync(certDir, { recursive: true });

  for (const name of [
    "tls.pem",
    "tls.key",
    "ca.pem",
    "ca.cer",
    "remcochat-ca.mobileconfig",
  ]) {
    writeFile(path.join(certDir, name), "");
  }

  const res = runCheckProxyCerts(["--cert-dir", certDir], dir);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /must be non-empty/i);
});

test("check-proxy-certs accepts required non-empty files", () => {
  const dir = makeTempDir();
  const certDir = path.join(dir, "nginx", "certs");
  fs.mkdirSync(certDir, { recursive: true });

  for (const name of [
    "tls.pem",
    "tls.key",
    "ca.pem",
    "ca.cer",
    "remcochat-ca.mobileconfig",
  ]) {
    writeFile(path.join(certDir, name), "x");
  }

  const res = runCheckProxyCerts(["--cert-dir", certDir], dir);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /OK: proxy cert artifacts present/i);
});

