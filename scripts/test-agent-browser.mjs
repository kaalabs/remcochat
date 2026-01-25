import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.REMCOCHAT_AGENT_BROWSER_PORT ?? "3120", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SESSION =
  process.env.REMCOCHAT_AGENT_BROWSER_SESSION ?? `remcochat-agent-browser-${PORT}`;
const DB_PATH =
  process.env.REMCOCHAT_AGENT_BROWSER_DB_PATH ??
  "data/remcochat-agent-browser.sqlite";
const CONFIG_PATH =
  process.env.REMCOCHAT_AGENT_BROWSER_CONFIG_PATH ??
  "data/remcochat-agent-browser-config.toml";
const ARTIFACT_DIR =
  process.env.REMCOCHAT_AGENT_BROWSER_ARTIFACT_DIR ?? "test-results/agent-browser";
const ENABLE_VERCEL_SANDBOX_BASH =
  process.env.REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX === "1";

function writeTempUploadFile(contents) {
  const filePath = path.join(
    os.tmpdir(),
    `remcochat-agent-browser-upload-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
  );
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpOk(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server: ${url}`);
}

async function runAgentBrowser(args) {
  let lastErr;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await execFileAsync("agent-browser", ["--session", SESSION, ...args], {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return String(res.stdout ?? "").trim();
    } catch (err) {
      lastErr = err;
      const stderr = String(err?.stderr ?? "");
      const message = String(err?.message ?? "");
      const combined = `${message}\n${stderr}`;
      const isTransient = /Resource temporarily unavailable|EAGAIN/i.test(combined);
      if (isTransient && attempt < 10) {
        await sleep(400 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function closeAgentBrowser() {
  try {
    await runAgentBrowser(["close"]);
  } catch {
    // ignore
  }
}

async function stopSpawnedServer(proc) {
  if (!proc) return;
  if (proc.killed) return;

  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    proc.kill("SIGTERM");
  }

  await Promise.race([new Promise((r) => proc.on("exit", r)), sleep(10_000)]);

  if (proc.exitCode == null) {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }
}

function modelIdFromModelFeatureTestId(value) {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("model-feature:")) return "";
  if (!raw.endsWith(":reasoning")) return "";
  return raw.slice("model-feature:".length, -":reasoning".length);
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const startedAt = Date.now();
  console.log(`[agent-browser] Starting smoke test against ${BASE_URL}`);

  await closeAgentBrowser();

  const serverEnv = {
    ...process.env,
    REMCOCHAT_DB_PATH: DB_PATH,
    REMCOCHAT_CONFIG_PATH: CONFIG_PATH,
    REMCOCHAT_ENABLE_ADMIN: "1",
    ...(ENABLE_VERCEL_SANDBOX_BASH ? { REMCOCHAT_ENABLE_BASH_TOOL: "1" } : {}),
  };

  await execFileAsync("node", ["scripts/reset-e2e-db.mjs"], {
    env: serverEnv,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  await execFileAsync(npmBin(), ["run", "build"], {
    env: serverEnv,
    timeout: 10 * 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const server = spawn(
    npmBin(),
    ["run", "start", "--", "-p", String(PORT), "-H", "127.0.0.1"],
    { env: serverEnv, stdio: "inherit", detached: true }
  );

  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });

  try {
    await waitForHttpOk(`${BASE_URL}/admin`, 90_000);

    await runAgentBrowser(["set", "viewport", "1280", "800"]);

    await runAgentBrowser(["open", `${BASE_URL}/`]);
    await runAgentBrowser(["wait", "--text", "RemcoChat"]);
    await runAgentBrowser([
      "screenshot",
      path.join(ARTIFACT_DIR, "01-home.png"),
    ]);

    // Reasoning segmented buttons:
    // - must be hidden for non-reasoning models
    // - must be visible for reasoning-capable models
    await runAgentBrowser([
      "find",
      "first",
      "[data-testid='model:picker-trigger']",
      "click",
    ]);
    await runAgentBrowser([
      "wait",
      "--fn",
      "document.querySelector(\"[data-testid^='model-option:']\") != null",
    ]);

    const nonReasoningFeatureTestId = await runAgentBrowser([
      "get",
      "attr",
      "[data-testid^='model-feature:'][data-testid$=':reasoning'][data-enabled='false']",
      "data-testid",
    ]).catch(() => "");
    const nonReasoningModelId = modelIdFromModelFeatureTestId(
      nonReasoningFeatureTestId
    );
    if (nonReasoningModelId) {
      await runAgentBrowser([
        "find",
        "first",
        `[data-testid='model-option:${nonReasoningModelId}']`,
        "click",
      ]);
      await runAgentBrowser([
        "wait",
        "--fn",
        "document.querySelector(\"[data-testid='reasoning-option:auto']\") == null",
      ]);
    } else {
      // No non-reasoning models in the catalog; close the picker.
      await runAgentBrowser(["find", "first", "body", "press", "Escape"]);
    }

    await runAgentBrowser([
      "find",
      "first",
      "[data-testid='model:picker-trigger']",
      "click",
    ]);
    await runAgentBrowser([
      "wait",
      "--fn",
      "document.querySelector(\"[data-testid^='model-option:']\") != null",
    ]);

    const reasoningFeatureTestId = await runAgentBrowser([
      "get",
      "attr",
      "[data-testid^='model-feature:'][data-testid$=':reasoning'][data-enabled='true']",
      "data-testid",
    ]);
    const reasoningModelId = modelIdFromModelFeatureTestId(reasoningFeatureTestId);
    if (!reasoningModelId) {
      throw new Error("No reasoning-capable model found in the model picker.");
    }

    await runAgentBrowser([
      "find",
      "first",
      `[data-testid='model-option:${reasoningModelId}']`,
      "click",
    ]);
    await runAgentBrowser([
      "wait",
      "--fn",
      "document.querySelector(\"[data-testid='reasoning-option:auto']\") != null",
    ]);
    await runAgentBrowser([
      "find",
      "first",
      "[data-testid='reasoning-option:high']",
      "click",
    ]);
    const highSelected = await runAgentBrowser([
      "get",
      "attr",
      "[data-testid='reasoning-option:high']",
      "data-selected",
    ]);
    if (String(highSelected).trim() !== "true") {
      throw new Error(
        `Expected reasoning-option:high to be selected (data-selected=true), got: ${highSelected}`
      );
    }

    await runAgentBrowser([
      "screenshot",
      path.join(ARTIFACT_DIR, "01-reasoning-buttons.png"),
    ]);
    await runAgentBrowser(["find", "first", "[data-testid='sidebar:new-chat']", "click"]);
    await runAgentBrowser(["find", "first", "[data-testid^='sidebar:chat-menu:']", "click"]);
    await runAgentBrowser(["find", "text", "Rename", "click"]);
    await runAgentBrowser(["wait", "--text", "Rename chat"]);
    await runAgentBrowser([
      "find",
      "first",
      "[data-testid='chat:rename-input']",
      "fill",
      "Agent renamed chat",
    ]);
    await runAgentBrowser(["find", "first", "[data-testid='chat:rename-save']", "click"]);
    await runAgentBrowser(["wait", "--text", "Agent renamed chat"]);
    await runAgentBrowser([
      "screenshot",
      path.join(ARTIFACT_DIR, "02-renamed.png"),
    ]);

    const token = `REMCOCHAT_AGENT_BROWSER_ATTACHMENT_OK_${Date.now()}`;
    const fileContents = `TOKEN=${token}\n`;
    const uploadPath = writeTempUploadFile(fileContents);

    await runAgentBrowser([
      "upload",
      "input[type='file'][aria-label='Upload files']",
      uploadPath,
    ]);
    await runAgentBrowser([
      "find",
      "first",
      "[data-testid='composer:textarea']",
      "fill",
      "Read the attached document. Reply with the token value after TOKEN= exactly, and nothing else.",
    ]);
    await runAgentBrowser(["find", "first", "[data-testid='composer:submit']", "click"]);

    await runAgentBrowser([
      "wait",
      "--fn",
      "document.querySelector(\"[data-testid^='attachment:download:']\") != null",
    ]);

    const href = await runAgentBrowser([
      "get",
      "attr",
      "[data-testid^='attachment:download:']",
      "href",
    ]);
    if (!href) {
      throw new Error("Missing attachment download link.");
    }
    const downloadUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    const downloadRes = await fetch(downloadUrl, { method: "GET" });
    if (!downloadRes.ok) {
      throw new Error(`Attachment download failed: ${downloadRes.status}`);
    }
    const downloaded = await downloadRes.text();
    if (downloaded !== fileContents) {
      throw new Error("Downloaded attachment did not match uploaded contents.");
    }

    if (ENABLE_VERCEL_SANDBOX_BASH) {
      await runAgentBrowser(["find", "first", "[data-testid='model:picker-trigger']", "click"]);
      await runAgentBrowser([
        "find",
        "first",
        "[data-testid='model-option:anthropic/claude-opus-4.5']",
        "click",
      ]);

      await runAgentBrowser([
        "find",
        "first",
        "[data-testid='composer:textarea']",
        "fill",
        "Run: `python -c \"print('REMCOCHAT_PY_E2E_OK')\"`",
      ]);
      await runAgentBrowser(["find", "first", "[data-testid='composer:submit']", "click"]);
      await runAgentBrowser([
        "wait",
        "--fn",
        "document.querySelector(\"[data-testid='tool:bash']\") != null",
      ]);
      await runAgentBrowser(["wait", "--text", "REMCOCHAT_PY_E2E_OK"]);
    }

    await runAgentBrowser([
      "screenshot",
      path.join(ARTIFACT_DIR, "03-after-attachment.png"),
    ]);
    console.log(
      `[agent-browser] PASS in ${((Date.now() - startedAt) / 1000).toFixed(1)}s; artifacts in ${ARTIFACT_DIR}`
    );
  } finally {
    await closeAgentBrowser();

    if (!serverExited) {
      await stopSpawnedServer(server);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
