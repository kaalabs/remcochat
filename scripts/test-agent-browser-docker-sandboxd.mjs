import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.REMCOCHAT_AGENT_BROWSER_PORT ?? "3130", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await execFileAsync("agent-browser", args, {
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
      if (isTransient && attempt < 3) {
        await sleep(250 * attempt);
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

  const portMatch = SANDBOXD_URL.match(/:(\\d+)$/);
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

async function main() {
  if (!isDockerAvailable()) {
    throw new Error("Docker is not available (docker info failed).");
  }

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const startedAt = Date.now();
  console.log(`[agent-browser] Starting docker sandboxd smoke test against ${BASE_URL}`);

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
    { env: serverEnv, stdio: "inherit" }
  );
  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });

  try {
    await waitForHttpOk(`${BASE_URL}/admin`, 90_000);
    await runAgentBrowser(["set", "viewport", "1280", "800"]);

    await runAgentBrowser(["open", `${BASE_URL}/admin`]);
    await runAgentBrowser(["wait", "--text", "Models catalog"]);
    await runAgentBrowser(["wait", "--text", "e2e_alt"]);

    await runAgentBrowser(["open", `${BASE_URL}/`]);
    await runAgentBrowser(["wait", "--text", "RemcoChat"]);
    await runAgentBrowser(["find", "first", "[data-testid='sidebar:new-chat']", "click"]);

    await runAgentBrowser(["find", "first", "[data-testid='composer:textarea']", "fill", [
      "You MUST call the bash tool to run exactly this command:",
      "",
      "`echo REMCOCHAT_DOCKER_SANDBOXD_AGENT_BROWSER_OK`",
      "",
      "Then reply with the command output only.",
    ].join("\\n")]);
    await runAgentBrowser(["find", "first", "[data-testid='composer:submit']", "click"]);

    await runAgentBrowser([
      "wait",
      "--fn",
      "document.querySelector(\"[data-testid='tool:bash']\") != null",
    ]);
    await runAgentBrowser(["wait", "--text", "REMCOCHAT_DOCKER_SANDBOXD_AGENT_BROWSER_OK"]);

    await runAgentBrowser([
      "screenshot",
      path.join(ARTIFACT_DIR, "01-bash-ok.png"),
    ]);

    console.log(
      `[agent-browser] PASS in ${((Date.now() - startedAt) / 1000).toFixed(1)}s; artifacts in ${ARTIFACT_DIR}`
    );
  } finally {
    await closeAgentBrowser();

    if (!serverExited) {
      server.kill("SIGTERM");
      await Promise.race([new Promise((r) => server.on("exit", r)), sleep(10_000)]);
    }
    if (!serverExited) server.kill("SIGKILL");

    await stopProcess(sandboxdProc);
    cleanupSandboxContainers();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
