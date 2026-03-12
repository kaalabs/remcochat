import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.REMCOCHAT_AGENT_BROWSER_PORT ?? "3130", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SESSION =
  process.env.REMCOCHAT_AGENT_BROWSER_SESSION ?? `remcochat-agent-browser-${PORT}`;
const DB_PATH =
  process.env.REMCOCHAT_AGENT_BROWSER_DB_PATH ??
  "data/remcochat-agent-browser-docker.sqlite";
const CONFIG_PATH =
  process.env.REMCOCHAT_AGENT_BROWSER_CONFIG_PATH ??
  "data/remcochat-agent-browser-docker-config.toml";

const SANDBOXD_URL = String(
  process.env.REMCOCHAT_E2E_DOCKER_SANDBOXD_URL ?? "http://127.0.0.1:8080"
)
  .trim()
  .replace(/\/+$/, "");

const ARTIFACT_DIR =
  process.env.REMCOCHAT_AGENT_BROWSER_ARTIFACT_DIR ??
  "test-results/agent-browser-docker-sandboxd";

const CHECKPOINT_FILES = {
  bashRequested: "01-approval-requested.png",
  bashApproved: "02-approval-approved-result.png",
  bashDenied: "03-approval-denied-result.png",
  autoRun: "04-non-sensitive-tool-auto-run.png",
  multiStep: "05-post-multistep-completion.png",
};

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
    suite: "agent-browser-docker-sandboxd",
    baseUrl: BASE_URL,
    sandboxdUrl: SANDBOXD_URL,
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

async function assertSingleToolCard(tracker, testId) {
  const countRaw = await runAgentBrowser(
    ["eval", `document.querySelectorAll("[data-testid='${testId}']").length`],
    tracker
  );
  const count = Number(normalizeAgentBrowserString(countRaw));
  if (!Number.isFinite(count) || count !== 1) {
    throw new Error(`Expected exactly one ${testId} card, got: ${countRaw}`);
  }
  tracker.appendLog(`Verified exactly one ${testId} card`);
}

function isDockerAvailable() {
  const res = spawnSync("docker", ["info"], { stdio: "ignore" });
  return res.status === 0;
}

function ensureSandboxImageBuilt() {
  const inspect = spawnSync("docker", ["image", "inspect", "remcochat-sandbox:node24"], {
    stdio: "ignore",
  });
  if (inspect.status === 0) return;

  const build = spawnSync(
    "docker",
    ["build", "-t", "remcochat-sandbox:node24", "-f", "sandbox-images/node24/Dockerfile", "."],
    { stdio: "inherit" }
  );
  if (build.status !== 0) throw new Error("Failed to build remcochat-sandbox:node24 image.");
}

async function startSandboxd() {
  const healthUrl = `${SANDBOXD_URL}/v1/health`;
  try {
    const res = await fetch(healthUrl, { method: "GET" });
    if (res.ok) return { proc: null };
  } catch {
    // ignore
  }

  const portMatch = SANDBOXD_URL.match(/:(\d+)$/);
  const port = portMatch?.[1] ? Number(portMatch[1]) : 8080;

  const proc = spawn("node", ["--import", "tsx", "sandboxd/src/index.ts"], {
    stdio: "pipe",
    env: { ...process.env, SANDBOXD_BIND_HOST: "127.0.0.1", SANDBOXD_PORT: String(port) },
  });
  proc.stdout.on("data", (d) => process.stdout.write(d));
  proc.stderr.on("data", (d) => process.stderr.write(d));

  await waitForHttpOk(healthUrl, 30_000);
  return { proc };
}

async function stopProcess(proc) {
  if (!proc) return;
  if (proc.killed) return;
  proc.kill("SIGTERM");
  await Promise.race([new Promise((r) => proc.on("exit", r)), sleep(10_000)]);
  if (proc.exitCode == null) {
    proc.kill("SIGKILL");
  }
}

function cleanupSandboxContainers() {
  const ids = spawnSync("docker", ["ps", "-aq", "--filter", "label=remcochat.sandboxId"], {
    encoding: "utf8",
  });
  const list = String(ids.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of list) {
    spawnSync("docker", ["rm", "-f", id], { stdio: "ignore" });
  }

  const vols = spawnSync("docker", ["volume", "ls", "-q", "--filter", "label=remcochat.sandboxId"], {
    encoding: "utf8",
  });
  const vlist = String(vols.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of vlist) {
    spawnSync("docker", ["volume", "rm", "-f", name], { stdio: "ignore" });
  }
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
  if (!isDockerAvailable()) {
    throw new Error("Docker is not available (docker info failed).");
  }

  const tracker = createArtifactTracker();
  const startedAt = Date.now();
  tracker.appendLog(`Starting docker sandboxd smoke test against ${BASE_URL}`);
  tracker.appendLog(`DB_PATH=${path.resolve(DB_PATH)}`);
  tracker.appendLog(`CONFIG_PATH=${path.resolve(CONFIG_PATH)}`);
  tracker.appendLog(`SANDBOXD_URL=${SANDBOXD_URL}`);
  tracker.appendLog(`ARTIFACT_DIR=${path.resolve(ARTIFACT_DIR)}`);

  await closeAgentBrowser(tracker);
  await ensurePortIsFree(PORT, tracker);

  ensureSandboxImageBuilt();
  const { proc: sandboxdProc } = await startSandboxd();

  const serverEnv = {
    ...process.env,
    REMCOCHAT_DB_PATH: DB_PATH,
    REMCOCHAT_CONFIG_PATH: CONFIG_PATH,
    REMCOCHAT_ENABLE_ADMIN: "1",
    REMCOCHAT_ENABLE_BASH_TOOL: "1",
    REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD: "1",
    REMCOCHAT_E2E_DOCKER_SANDBOXD_URL: SANDBOXD_URL,
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

    await runAgentBrowser(["open", `${BASE_URL}/admin`], tracker);
    await runAgentBrowser(["wait", "--text", "Local access whitelist"], tracker);

    await runAgentBrowser(["open", `${BASE_URL}/`], tracker);
    await runAgentBrowser(["wait", "--text", "RemcoChat"], tracker);
    await runAgentBrowser(
      ["wait", "--fn", "document.querySelector(\"[data-testid='composer:textarea']\") != null"],
      tracker
    );

    const approvalToken = `REMCOCHAT_DOCKER_SANDBOXD_APPROVED_${Date.now()}`;
    await submitPrompt(
      `Voer een hello-world Python-programma uit dat exact ${approvalToken} print en verder niets.`,
      tracker
    );
    await runAgentBrowser(
      [
        "wait",
        "--fn",
        "document.querySelector(\"[data-testid^='tool-approval:approve:bash:']\") != null",
      ],
      tracker
    );
    await captureCheckpoint(tracker, "approval-requested", CHECKPOINT_FILES.bashRequested);
    await runAgentBrowser(
      ["find", "first", "[data-testid^='tool-approval:approve:bash:']", "click"],
      tracker
    );
    await runAgentBrowser(["wait", "--text", approvalToken], tracker);
    await assertSingleToolCard(tracker, "tool:bash");
    await captureCheckpoint(tracker, "approval-approved-result", CHECKPOINT_FILES.bashApproved);
    await captureCheckpoint(tracker, "post-multistep-completion", CHECKPOINT_FILES.multiStep);

    await runAgentBrowser(["open", `${BASE_URL}/`], tracker);
    await runAgentBrowser(["wait", "--text", "RemcoChat"], tracker);
    await startNewChat(tracker);
    await submitPrompt(
      "Voer een Python-programma uit dat exact REMCOCHAT_DOCKER_SANDBOXD_DENIED print en verder niets.",
      tracker
    );
    await runAgentBrowser(
      [
        "wait",
        "--fn",
        "document.querySelector(\"[data-testid^='tool-approval:deny:bash:']\") != null",
      ],
      tracker
    );
    await runAgentBrowser(
      ["find", "first", "[data-testid^='tool-approval:deny:bash:']", "click"],
      tracker
    );
    await runAgentBrowser(
      [
        "wait",
        "--fn",
        `(() => {
          const tool = document.querySelector("[data-testid='tool:bash']");
          const text = tool?.textContent ?? "";
          return /Denied|Geweigerd/i.test(text);
        })()`,
      ],
      tracker
    );
    await captureCheckpoint(tracker, "approval-denied-result", CHECKPOINT_FILES.bashDenied);

    await runAgentBrowser(["open", `${BASE_URL}/`], tracker);
    await runAgentBrowser(["wait", "--text", "RemcoChat"], tracker);
    await startNewChat(tracker);
    await submitPrompt("What is the current date and time in Europe/Amsterdam?", tracker);
    await runAgentBrowser(
      ["wait", "--fn", "document.querySelector(\"[data-testid='tool:displayCurrentDateTime']\") != null"],
      tracker
    );
    await assertSingleCurrentDateTimeCard(tracker);
    await captureCheckpoint(tracker, "non-sensitive-tool-auto-run", CHECKPOINT_FILES.autoRun);

    tracker.assertArtifactsExist();
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    tracker.appendLog(`PASS in ${elapsedSeconds}s`);
    console.log(`[agent-browser] PASS in ${elapsedSeconds}s; artifacts in ${ARTIFACT_DIR}`);
  } finally {
    await closeAgentBrowser(tracker);

    if (!serverExited) {
      await stopSpawnedServer(server);
    }

    await stopProcess(sandboxdProc);
    cleanupSandboxContainers();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
