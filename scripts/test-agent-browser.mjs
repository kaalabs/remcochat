import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.REMCOCHAT_AGENT_BROWSER_PORT ?? "3120", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_PATH =
  process.env.REMCOCHAT_AGENT_BROWSER_DB_PATH ??
  "data/remcochat-agent-browser.sqlite";
const CONFIG_PATH =
  process.env.REMCOCHAT_AGENT_BROWSER_CONFIG_PATH ??
  "data/remcochat-agent-browser-config.toml";

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
  const res = await execFileAsync("agent-browser", args, {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return String(res.stdout ?? "").trim();
}

async function closeAgentBrowser() {
  try {
    await runAgentBrowser(["close"]);
  } catch {
    // ignore
  }
}

async function main() {
  const serverEnv = {
    ...process.env,
    REMCOCHAT_DB_PATH: DB_PATH,
    REMCOCHAT_CONFIG_PATH: CONFIG_PATH,
    REMCOCHAT_ENABLE_ADMIN: "1",
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
    await runAgentBrowser(["wait", "--text", "e2e_vercel"]);

    await runAgentBrowser(["find", "text", "E2E Vercel Catalog", "click"]);
    await runAgentBrowser(["wait", "--text", "openai/gpt-3.5-turbo"]);
    await runAgentBrowser(["wait", "--text", "anthropic/claude-opus-4.5"]);

    await runAgentBrowser(["open", `${BASE_URL}/`]);
    await runAgentBrowser(["wait", "--text", "RemcoChat"]);
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
  } finally {
    await closeAgentBrowser();

    if (!serverExited) {
      server.kill("SIGTERM");
      await Promise.race([new Promise((r) => server.on("exit", r)), sleep(10_000)]);
    }
    if (!serverExited) {
      server.kill("SIGKILL");
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
