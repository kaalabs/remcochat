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

const CHECKPOINT_FILES = {
  home: "01-home.png",
  reasoning: "02-reasoning-buttons.png",
  renamed: "03-renamed.png",
  attachment: "04-after-attachment.png",
  autoRun: "05-non-sensitive-tool-auto-run.png",
};

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

async function ensurePortIsFree(port, tracker) {
  try {
    const { stdout } = await execFileAsync("bash", ["-lc", `lsof -ti tcp:${port} || true`], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    const pids = String(stdout ?? "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const pid of pids) {
      tracker.appendLog(`Killing stale process on port ${port}: ${pid}`);
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

function createArtifactTracker() {
  fs.rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const logPath = path.join(ARTIFACT_DIR, "run.log");
  const manifestPath = path.join(ARTIFACT_DIR, "manifest.json");
  const manifest = {
    suite: "agent-browser",
    baseUrl: BASE_URL,
    artifactDir: ARTIFACT_DIR,
    generatedAt: new Date().toISOString(),
    checkpoints: [],
    commands: [],
  };

  const appendLog = (line) => {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  };

  const recordCommand = (command) => {
    manifest.commands.push(command);
    appendLog(`command ${command}`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  };

  const recordCheckpoint = (name, filename) => {
    const filePath = path.join(ARTIFACT_DIR, filename);
    manifest.checkpoints.push({
      name,
      file: filePath,
      recordedAt: new Date().toISOString(),
    });
    appendLog(`checkpoint ${name} -> ${filePath}`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return filePath;
  };

  const assertArtifactsExist = () => {
    const requiredPaths = [
      logPath,
      manifestPath,
      ...Object.values(CHECKPOINT_FILES).map((filename) => path.join(ARTIFACT_DIR, filename)),
    ];
    for (const filePath of requiredPaths) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Missing required artifact: ${filePath}`);
      }
    }
  };

  return {
    appendLog,
    assertArtifactsExist,
    logPath,
    manifestPath,
    recordCheckpoint,
    recordCommand,
  };
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

async function runAgentBrowser(args, tracker) {
  tracker.recordCommand(`agent-browser --session ${SESSION} ${args.join(" ")}`);
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

async function closeAgentBrowser(tracker) {
  try {
    await runAgentBrowser(["close"], tracker);
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

function normalizeAgentBrowserString(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return String(JSON.parse(raw));
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

async function captureCheckpoint(tracker, name, filename) {
  const screenshotPath = tracker.recordCheckpoint(name, filename);
  await runAgentBrowser(["screenshot", screenshotPath], tracker);
}

async function startNewChat(tracker) {
  await runAgentBrowser(
    [
      "wait",
      "--fn",
      `(() => {
        const button = document.querySelector("[data-testid='sidebar:new-chat']");
        return Boolean(button) && !(button instanceof HTMLButtonElement && button.disabled);
      })()`,
    ],
    tracker
  );
  await runAgentBrowser(["find", "first", "[data-testid='sidebar:new-chat']", "click"], tracker);
  await runAgentBrowser(["wait", "--fn", "document.querySelector(\"[data-testid='composer:textarea']\") != null"], tracker);
  await runAgentBrowser(["wait", "750"], tracker);
}

async function submitPrompt(text, tracker) {
  await runAgentBrowser(
    ["find", "first", "[data-testid='composer:textarea']", "fill", text],
    tracker
  );
  await runAgentBrowser(
    [
      "wait",
      "--fn",
      `(() => {
        const button = document.querySelector("[data-testid='composer:submit']");
        return Boolean(button) && !(button instanceof HTMLButtonElement && button.disabled);
      })()`,
    ],
    tracker
  );
  await runAgentBrowser(["find", "first", "[data-testid='composer:submit']", "click"], tracker);
}

async function assertSingleCurrentDateTimeCard(tracker) {
  await runAgentBrowser(["wait", "2000"], tracker);
  const countRaw = await runAgentBrowser(
    [
      "eval",
      `document.querySelectorAll("[data-testid='tool:displayCurrentDateTime']").length`,
    ],
    tracker,
  );
  const count = Number(normalizeAgentBrowserString(countRaw));
  if (!Number.isFinite(count) || count !== 1) {
    throw new Error(`Expected exactly one displayCurrentDateTime card, got: ${countRaw}`);
  }
  tracker.appendLog("Verified exactly one displayCurrentDateTime card");
}

async function main() {
  const tracker = createArtifactTracker();
  const startedAt = Date.now();
  tracker.appendLog(`Starting smoke test against ${BASE_URL}`);
  tracker.appendLog(`DB_PATH=${path.resolve(DB_PATH)}`);
  tracker.appendLog(`CONFIG_PATH=${path.resolve(CONFIG_PATH)}`);
  tracker.appendLog(`ARTIFACT_DIR=${path.resolve(ARTIFACT_DIR)}`);

  await closeAgentBrowser(tracker);
  await ensurePortIsFree(PORT, tracker);

  const serverEnv = {
    ...process.env,
    REMCOCHAT_DB_PATH: DB_PATH,
    REMCOCHAT_CONFIG_PATH: CONFIG_PATH,
    REMCOCHAT_ENABLE_ADMIN: "1",
    REMCOCHAT_E2E_ENABLE_LOCAL_ACCESS: "1",
    ...(ENABLE_VERCEL_SANDBOX_BASH ? { REMCOCHAT_ENABLE_BASH_TOOL: "1" } : {}),
  };

  tracker.recordCommand("node scripts/reset-e2e-db.mjs");
  await execFileAsync("node", ["scripts/reset-e2e-db.mjs"], {
    env: serverEnv,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  tracker.recordCommand(`${npmBin()} run build`);
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

    await runAgentBrowser(["set", "viewport", "1280", "800"], tracker);

    await runAgentBrowser(["open", `${BASE_URL}/`], tracker);
    await runAgentBrowser(["wait", "--text", "RemcoChat"], tracker);
    await captureCheckpoint(tracker, "home", CHECKPOINT_FILES.home);

    await runAgentBrowser(
      ["find", "first", "[data-testid='model:picker-trigger']", "click"],
      tracker
    );
    await runAgentBrowser(
      ["wait", "--fn", "document.querySelector(\"[data-testid^='model-option:']\") != null"],
      tracker
    );

    const nonReasoningFeatureTestId = normalizeAgentBrowserString(
      await runAgentBrowser(
        [
          "eval",
          `(() => {
            const el = document.querySelector(
              "[data-testid^='model-feature:'][data-testid$=':reasoning'][data-enabled='false']"
            );
            return el ? el.getAttribute("data-testid") ?? "" : "";
          })()`,
        ],
        tracker
      ).catch(() => "")
    );
    const nonReasoningModelId = modelIdFromModelFeatureTestId(nonReasoningFeatureTestId);
    if (nonReasoningModelId) {
      await runAgentBrowser(
        ["find", "first", `[data-testid='model-option:${nonReasoningModelId}']`, "click"],
        tracker
      );
      await runAgentBrowser(
        ["wait", "--fn", "document.querySelector(\"[data-testid='reasoning-option:auto']\") == null"],
        tracker
      );
    } else {
      await runAgentBrowser(["press", "Escape"], tracker);
    }

    await runAgentBrowser(
      ["find", "first", "[data-testid='model:picker-trigger']", "click"],
      tracker
    );
    await runAgentBrowser(
      ["wait", "--fn", "document.querySelector(\"[data-testid^='model-option:']\") != null"],
      tracker
    );

    const reasoningFeatureTestId = normalizeAgentBrowserString(
      await runAgentBrowser(
        [
          "eval",
          `(() => {
            const el = document.querySelector(
              "[data-testid^='model-feature:'][data-testid$=':reasoning'][data-enabled='true']"
            );
            return el ? el.getAttribute("data-testid") ?? "" : "";
          })()`,
        ],
        tracker
      ).catch(() => "")
    );
    const reasoningModelId = modelIdFromModelFeatureTestId(reasoningFeatureTestId);
    if (!reasoningModelId) {
      throw new Error("No reasoning-capable model option was found in the picker.");
    }
    await runAgentBrowser(
      ["wait", `[data-testid='model-option:${reasoningModelId}']`],
      tracker
    );
    await runAgentBrowser(
      ["find", "first", `[data-testid='model-option:${reasoningModelId}']`, "click"],
      tracker
    );
    await runAgentBrowser(
      ["wait", "--fn", "document.querySelector(\"[data-testid='reasoning-option:auto']\") != null"],
      tracker
    );
    await runAgentBrowser(
      ["find", "first", "[data-testid='reasoning-option:high']", "click"],
      tracker
    );
    const highSelected = await runAgentBrowser(
      ["get", "attr", "[data-testid='reasoning-option:high']", "data-selected"],
      tracker
    );
    if (String(highSelected).trim() !== "true") {
      throw new Error(
        `Expected reasoning-option:high to be selected (data-selected=true), got: ${highSelected}`
      );
    }

    await captureCheckpoint(tracker, "reasoning-buttons", CHECKPOINT_FILES.reasoning);
    await startNewChat(tracker);
    await runAgentBrowser(
      ["find", "first", "[data-testid^='sidebar:chat-menu:']", "click"],
      tracker
    );
    await runAgentBrowser(
      ["find", "first", "[data-testid^='chat-action:rename:']", "click"],
      tracker
    );
    await runAgentBrowser(["wait", "--text", "Rename chat"], tracker);
    await runAgentBrowser(
      ["find", "first", "[data-testid='chat:rename-input']", "fill", "Agent renamed chat"],
      tracker
    );
    await runAgentBrowser(["find", "first", "[data-testid='chat:rename-save']", "click"], tracker);
    await runAgentBrowser(["wait", "--text", "Agent renamed chat"], tracker);
    await captureCheckpoint(tracker, "renamed-chat", CHECKPOINT_FILES.renamed);

    const token = `REMCOCHAT_AGENT_BROWSER_ATTACHMENT_OK_${Date.now()}`;
    const fileContents = `TOKEN=${token}\n`;
    const uploadPath = writeTempUploadFile(fileContents);

    await runAgentBrowser(
      ["upload", "input[type='file'][aria-label='Upload attachments']", uploadPath],
      tracker
    );
    await submitPrompt(
      "Read the attached document. Reply with the token value after TOKEN= exactly, and nothing else.",
      tracker
    );

    await runAgentBrowser(
      ["wait", "--fn", "document.querySelector(\"[data-testid^='attachment:download:']\") != null"],
      tracker
    );

    const href = await runAgentBrowser(
      ["get", "attr", "[data-testid^='attachment:download:']", "href"],
      tracker
    );
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
    await captureCheckpoint(tracker, "attachment", CHECKPOINT_FILES.attachment);

    await startNewChat(tracker);
    await submitPrompt("What is the current date and time in Europe/Amsterdam?", tracker);
    await runAgentBrowser(
      ["wait", "--fn", "document.querySelector(\"[data-testid='tool:displayCurrentDateTime']\") != null"],
      tracker
    );
    await assertSingleCurrentDateTimeCard(tracker);
    await captureCheckpoint(tracker, "non-sensitive-tool-auto-run", CHECKPOINT_FILES.autoRun);

    if (ENABLE_VERCEL_SANDBOX_BASH) {
      await startNewChat(tracker);
      await runAgentBrowser(
        ["find", "first", "[data-testid='model:picker-trigger']", "click"],
        tracker
      );
      await runAgentBrowser(
        ["find", "first", "[data-testid='model-option:anthropic/claude-opus-4.5']", "click"],
        tracker
      );
      await submitPrompt(
        "Voer een hello-world Python-programma uit dat exact REMCOCHAT_PY_E2E_OK print en verder niets.",
        tracker
      );
      await runAgentBrowser(
        ["wait", "--fn", "document.querySelector(\"[data-testid='tool:bash']\") != null"],
        tracker
      );
      await runAgentBrowser(["wait", "--text", "REMCOCHAT_PY_E2E_OK"], tracker);
    }

    tracker.assertArtifactsExist();
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    tracker.appendLog(`PASS in ${elapsedSeconds}s`);
    console.log(`[agent-browser] PASS in ${elapsedSeconds}s; artifacts in ${ARTIFACT_DIR}`);
  } finally {
    await closeAgentBrowser(tracker);

    if (!serverExited) {
      await stopSpawnedServer(server);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
