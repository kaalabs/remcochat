import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
