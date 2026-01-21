import { expect, test } from "@playwright/test";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  getUIMessageStreamErrors,
  parseUIMessageStreamChunks,
} from "./ui-message-stream";

async function createProfile(request: import("@playwright/test").APIRequestContext) {
  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E bash ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile: { id: string } };
  return profileJson.profile.id;
}

test("Bash tools run a command in Vercel Sandbox", async ({ request }) => {
  test.skip(
    process.env.REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX !== "1",
    "Set REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX=1 (and Vercel Sandbox creds + REMCOCHAT_ENABLE_BASH_TOOL=1) to run this test."
  );

  const profileId = await createProfile(request);
  const temporarySessionId = `e2e-bash-${Date.now()}`;

  const chatRes = await request.post("/api/chat", {
    data: {
      profileId,
      modelId: "gpt-5.2-codex",
      temporary: true,
      temporarySessionId,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              text: "Run: `echo REMCOCHAT_BASH_E2E_OK`",
            },
          ],
          metadata: { createdAt: new Date().toISOString() },
        },
      ],
    },
  });
  expect(chatRes.ok()).toBeTruthy();

  const headers = chatRes.headers();
  expect(headers["x-remcochat-bash-tools-enabled"]).toBe("1");

  const chunks = parseUIMessageStreamChunks(await chatRes.body());
  expect(getUIMessageStreamErrors(chunks)).toEqual([]);

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value && typeof value === "object");
  };

  const stdout = chunks
    .filter((c) => String(c.toolName ?? "") === "bash")
    .map((c) => {
      const type = String(c.type ?? "");
      if (type !== "tool-output-available" && type !== "tool-result") return "";

      const payload =
        c.output ?? c.result ?? c.toolOutput ?? c.toolResult;
      if (!isRecord(payload)) return "";

      return typeof payload.stdout === "string" ? payload.stdout : "";
    })
    .filter(Boolean)
    .join("\n");

  expect(stdout).toContain("REMCOCHAT_BASH_E2E_OK");
});

function isDockerAvailable(): boolean {
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
  if (build.status !== 0) {
    throw new Error("Failed to build remcochat-sandbox:node24 image.");
  }
}

async function startSandboxd(): Promise<{
  url: string;
  proc: ChildProcessWithoutNullStreams | null;
}> {
  const url = String(process.env.REMCOCHAT_E2E_DOCKER_SANDBOXD_URL ?? "http://127.0.0.1:8080")
    .trim()
    .replace(/\/+$/, "");

  const health = async () => {
    const res = await fetch(`${url}/v1/health`).catch(() => null);
    return Boolean(res && res.ok);
  };

  if (await health()) return { url, proc: null };

  const portMatch = url.match(/:(\d+)$/);
  const port = portMatch?.[1] ? Number(portMatch[1]) : 8080;

  const proc = spawn("node", ["--import", "tsx", "sandboxd/src/index.ts"], {
    stdio: "pipe",
    env: {
      ...process.env,
      SANDBOXD_BIND_HOST: "127.0.0.1",
      SANDBOXD_PORT: String(port),
    },
  });

  proc.stdout.on("data", (d) => process.stdout.write(d));
  proc.stderr.on("data", (d) => process.stderr.write(d));

  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (await health()) return { url, proc };
    await delay(200);
  }

  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }
  throw new Error("sandboxd did not become healthy in time.");
}

async function stopSandboxd(proc: ChildProcessWithoutNullStreams | null) {
  if (!proc) return;
  if (proc.killed) return;

  proc.kill("SIGTERM");
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    if (proc.exitCode !== null) return;
    await delay(100);
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
}

test("Bash tools run a command in Docker sandboxd", async ({ request }) => {
  test.skip(
    process.env.REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD !== "1",
    "Set REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD=1 (plus Docker + REMCOCHAT_ENABLE_BASH_TOOL=1) to run this test."
  );

  test.skip(!isDockerAvailable(), "Docker is not available (docker info failed).");

  ensureSandboxImageBuilt();
  const { proc } = await startSandboxd();

  try {
    const profileId = await createProfile(request);
    const temporarySessionId = `e2e-bash-docker-${Date.now()}`;

    const chatRes = await request.post("/api/chat", {
      data: {
        profileId,
        modelId: "gpt-5.2-codex",
        temporary: true,
        temporarySessionId,
        messages: [
          {
            id: `user-${Date.now()}`,
            role: "user",
            parts: [
              {
                type: "text",
                text: "Run: `echo REMCOCHAT_BASH_DOCKER_E2E_OK`",
              },
            ],
            metadata: { createdAt: new Date().toISOString() },
          },
        ],
      },
    });
    expect(chatRes.ok()).toBeTruthy();

    const headers = chatRes.headers();
    expect(headers["x-remcochat-bash-tools-enabled"]).toBe("1");

    const chunks = parseUIMessageStreamChunks(await chatRes.body());
    expect(getUIMessageStreamErrors(chunks)).toEqual([]);

    const isRecord = (value: unknown): value is Record<string, unknown> => {
      return Boolean(value && typeof value === "object");
    };

    const stdout = chunks
      .filter((c) => String(c.toolName ?? "") === "bash")
      .map((c) => {
        const type = String(c.type ?? "");
        if (type !== "tool-output-available" && type !== "tool-result") return "";

        const payload = c.output ?? c.result ?? c.toolOutput ?? c.toolResult;
        if (!isRecord(payload)) return "";

        return typeof payload.stdout === "string" ? payload.stdout : "";
      })
      .filter(Boolean)
      .join("\n");

    expect(stdout).toContain("REMCOCHAT_BASH_DOCKER_E2E_OK");
  } finally {
    await stopSandboxd(proc);
  }
});
