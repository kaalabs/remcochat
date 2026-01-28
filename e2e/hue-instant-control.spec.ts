import { expect, test } from "@playwright/test";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  getUIMessageStreamErrors,
  getUIMessageStreamText,
  parseUIMessageStreamChunks,
} from "./ui-message-stream";

type StreamChunk = ReturnType<typeof parseUIMessageStreamChunks>[number];

const HUE_HOST_BASE_URL = String(
  process.env.REMCOCHAT_E2E_HUE_GATEWAY_BASE_URL ?? "http://localhost:8000"
)
  .trim()
  .replace(/\/+$/, "");

const ENABLE_DOCKER_SANDBOXD = process.env.REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD === "1";

const SANDBOXD_URL = String(
  process.env.REMCOCHAT_E2E_DOCKER_SANDBOXD_URL ?? "http://127.0.0.1:8080"
)
  .trim()
  .replace(/\/+$/, "");

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
  const url = SANDBOXD_URL;
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

async function createProfile(request: import("@playwright/test").APIRequestContext) {
  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E hue ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile: { id: string } };
  return profileJson.profile.id;
}

async function getToolsEnabledModelId(request: import("@playwright/test").APIRequestContext) {
  const providersRes = await request.get("/api/providers");
  expect(providersRes.ok()).toBeTruthy();
  const providersJson = (await providersRes.json()) as {
    activeProviderId: string;
    providers: Array<{
      id: string;
      models: Array<{ id: string; capabilities?: { tools?: boolean } }>;
    }>;
  };

  const active =
    providersJson.providers.find((p) => p.id === providersJson.activeProviderId) ??
    providersJson.providers[0];
  const toolEnabled = (active?.models ?? []).filter((m) => m.capabilities?.tools === true);
  const preferred = ["gpt-5.2-codex", "gpt-5.2", "gpt-5-nano"];
  return preferred.find((id) => toolEnabled.some((m) => m.id === id)) ?? toolEnabled[0]?.id ?? "";
}

type HueActionResponse = {
  requestId?: unknown;
  action?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
};

async function hueHostAction(payload: Record<string, unknown>) {
  const res = await fetch(`${HUE_HOST_BASE_URL}/v1/actions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer dev-token",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: HueActionResponse | null = null;
  try {
    json = JSON.parse(text) as HueActionResponse;
  } catch {
    json = null;
  }

  return { status: res.status, ok: res.ok, text, json };
}

async function getGroupedLightRidForRoom(roomName: string): Promise<string> {
  const out = await hueHostAction({
    action: "clipv2.request",
    args: { method: "GET", path: "/clip/v2/resource/room" },
  });
  if (!out.ok || !out.json || out.json.ok !== true) {
    throw new Error(`Failed to list rooms from Hue Gateway (status=${out.status}).`);
  }

  const body = (out.json.result as any)?.body ?? {};
  const rooms = Array.isArray(body.data) ? body.data : [];
  const target = rooms.find((r: any) => {
    const name = String(r?.metadata?.name ?? "").trim();
    return name.toLowerCase() === roomName.toLowerCase();
  });
  if (!target) throw new Error(`Room not found: ${roomName}`);

  const services = Array.isArray(target.services) ? target.services : [];
  const gl = services.find((s: any) => String(s?.rtype ?? "") === "grouped_light");
  const rid = String(gl?.rid ?? "").trim();
  if (!rid) throw new Error(`Missing grouped_light rid for room: ${roomName}`);
  return rid;
}

async function getGroupedLightOnState(rid: string): Promise<boolean> {
  const out = await hueHostAction({
    action: "clipv2.request",
    args: { method: "GET", path: `/clip/v2/resource/grouped_light/${rid}` },
  });
  if (!out.ok || !out.json || out.json.ok !== true) {
    throw new Error(`Failed to read grouped_light state (status=${out.status}).`);
  }

  const body = (out.json.result as any)?.body ?? {};
  const data = Array.isArray(body.data) ? body.data : [];
  const on = Boolean(data?.[0]?.on?.on);
  return on;
}

async function getLightDeviceNamesForRoom(roomName: string): Promise<string[]> {
  const roomsOut = await hueHostAction({
    action: "clipv2.request",
    args: { method: "GET", path: "/clip/v2/resource/room" },
  });
  if (!roomsOut.ok || !roomsOut.json || roomsOut.json.ok !== true) {
    throw new Error(`Failed to list rooms from Hue Gateway (status=${roomsOut.status}).`);
  }

  const roomsBody = (roomsOut.json.result as any)?.body ?? {};
  const rooms = Array.isArray(roomsBody.data) ? roomsBody.data : [];
  const room = rooms.find((r: any) => {
    const name = String(r?.metadata?.name ?? "").trim();
    return name.toLowerCase() === roomName.toLowerCase();
  });
  if (!room) throw new Error(`Room not found: ${roomName}`);

  const childDeviceIds = new Set(
    (Array.isArray(room.children) ? room.children : [])
      .filter((c: any) => String(c?.rtype ?? "") === "device")
      .map((c: any) => String(c?.rid ?? "").trim())
      .filter(Boolean)
  );

  const devicesOut = await hueHostAction({
    action: "clipv2.request",
    args: { method: "GET", path: "/clip/v2/resource/device" },
  });
  if (!devicesOut.ok || !devicesOut.json || devicesOut.json.ok !== true) {
    throw new Error(`Failed to list devices from Hue Gateway (status=${devicesOut.status}).`);
  }

  const devicesBody = (devicesOut.json.result as any)?.body ?? {};
  const devices = Array.isArray(devicesBody.data) ? devicesBody.data : [];
  const names: string[] = [];
  for (const d of devices) {
    const id = String((d as any)?.id ?? "").trim();
    if (!id || !childDeviceIds.has(id)) continue;

    const services = Array.isArray((d as any)?.services) ? (d as any).services : [];
    const hasLightService = services.some((s: any) => String(s?.rtype ?? "") === "light");
    if (!hasLightService) continue;

    const name = String((d as any)?.metadata?.name ?? "").trim();
    if (name) names.push(name);
  }

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function extractToolInputs(chunks: StreamChunk[], toolName: string) {
  return chunks
    .filter((c) => c.type === "tool-input-available" && String(c.toolName ?? "") === toolName)
    .map((c) => c.input as any);
}

function extractBashCommands(chunks: StreamChunk[]): string[] {
  return extractToolInputs(chunks, "bash")
    .map((input) => String(input?.command ?? ""))
    .filter(Boolean);
}

type BashToolResult = { stdout: string; stderr: string; exitCode: number };

function extractBashResults(chunks: StreamChunk[]): BashToolResult[] {
  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value && typeof value === "object");
  };

  const toolNamesByCallId = new Map<string, string>();
  for (const c of chunks) {
    const type = String(c.type ?? "");
    if (type !== "tool-input-start" && type !== "tool-input-available" && type !== "tool-input-error") {
      continue;
    }

    const callId = typeof (c as any).toolCallId === "string" ? String((c as any).toolCallId) : "";
    const toolName = typeof (c as any).toolName === "string" ? String((c as any).toolName) : "";
    if (callId && toolName) toolNamesByCallId.set(callId, toolName);
  }

  const results: BashToolResult[] = [];
  for (const c of chunks) {
    const type = String(c.type ?? "");
    if (type !== "tool-output-available" && type !== "tool-result") continue;

    const callId = typeof (c as any).toolCallId === "string" ? String((c as any).toolCallId) : "";
    const toolName =
      typeof (c as any).toolName === "string"
        ? String((c as any).toolName)
        : callId
          ? toolNamesByCallId.get(callId) ?? ""
          : "";
    if (toolName !== "bash") continue;

    const payload = (c as any).output ?? (c as any).result ?? (c as any).toolOutput ?? (c as any).toolResult;
    if (!isRecord(payload)) continue;

    const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
    const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : -1;
    results.push({ stdout, stderr, exitCode });
  }

  return results;
}

test.describe("hue-instant-control", () => {
  let sandboxdProc: ChildProcessWithoutNullStreams | null = null;

  test.beforeAll(async () => {
    if (!ENABLE_DOCKER_SANDBOXD) return;
    if (!isDockerAvailable()) return;
    ensureSandboxImageBuilt();
    const started = await startSandboxd();
    sandboxdProc = started.proc;
  });

  test.afterAll(async () => {
    await stopSandboxd(sandboxdProc);
  });

  test("lists rooms from sandbox without changing lights", async ({ request }) => {
    test.skip(!ENABLE_DOCKER_SANDBOXD, "Set REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD=1 to run this test.");
    test.skip(!isDockerAvailable(), "Docker is not available (docker info failed).");

    const health = await fetch(`${HUE_HOST_BASE_URL}/healthz`, { method: "GET" }).catch(() => null);
    test.skip(!health?.ok, `Hue Gateway not reachable at ${HUE_HOST_BASE_URL}`);

    const modelId = await getToolsEnabledModelId(request);
    test.skip(!modelId, "No tools-enabled model found for active provider.");

    const profileId = await createProfile(request);
    const temporarySessionId = `e2e-hue-list-${Date.now()}`;

    const chatRes = await request.post("/api/chat", {
      data: {
        profileId,
        modelId,
        temporary: true,
        temporarySessionId,
        messages: [
          {
            id: `user-${Date.now()}`,
            role: "user",
            parts: [
              {
                type: "text",
                text: [
                  "/hue-instant-control",
                  "Do a fast connectivity check (base URL selection + readyz) and then list Hue rooms.",
                  "Requirements:",
                  "- Use the bash tool (do not just print curl).",
                  "- Do NOT change any light state.",
                  "- Use tight curl timeouts (--connect-timeout 1, --max-time).",
                  "- List rooms via clipv2.request GET /clip/v2/resource/room.",
                  "Reply with: done",
                ].join("\n"),
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

    const activated = extractToolInputs(chunks, "skillsActivate");
    expect(activated.some((i) => String(i?.name ?? "") === "hue-instant-control")).toBeTruthy();

    const bashCommands = extractBashCommands(chunks);
    expect(bashCommands.length).toBeGreaterThan(0);
    const bashJoined = bashCommands.join("\n\n");
    expect(bashJoined).toContain("--connect-timeout 1");
    expect(bashJoined).toContain("/healthz");
    expect(bashJoined).toContain("/readyz");
    expect(bashJoined).toContain("/v1/actions");
    expect(bashJoined).toContain("/clip/v2/resource/room");
    expect(bashJoined).not.toContain("grouped_light.set");

    const bashResults = extractBashResults(chunks);
    expect(bashResults.length).toBeGreaterThan(0);
    expect(bashResults.some((r) => r.exitCode === 0)).toBeTruthy();
    expect(getUIMessageStreamText(chunks)).toContain("done");
  });

  test("lists individual lamps in Woonkamer without errors", async ({ request }) => {
    test.skip(!ENABLE_DOCKER_SANDBOXD, "Set REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD=1 to run this test.");
    test.skip(!isDockerAvailable(), "Docker is not available (docker info failed).");

    const health = await fetch(`${HUE_HOST_BASE_URL}/healthz`, { method: "GET" }).catch(() => null);
    test.skip(!health?.ok, `Hue Gateway not reachable at ${HUE_HOST_BASE_URL}`);

    const expected = await getLightDeviceNamesForRoom("Woonkamer");
    test.skip(expected.length === 0, "No light devices found in room Woonkamer.");

    const modelId = await getToolsEnabledModelId(request);
    test.skip(!modelId, "No tools-enabled model found for active provider.");

    const profileId = await createProfile(request);
    const temporarySessionId = `e2e-hue-lamps-${Date.now()}`;

    const chatRes = await request.post("/api/chat", {
      data: {
        profileId,
        modelId,
        temporary: true,
        temporarySessionId,
        messages: [
          {
            id: `user-${Date.now()}`,
            role: "user",
            parts: [
              {
                type: "text",
                text: [
                  "/hue-instant-control",
                  "Maak een lijst van alle lampen (individuele licht devices) die beschikbaar zijn in de Woonkamer.",
                  "Constraints:",
                  "- Use bash tool.",
                  "- Do base URL selection + readyz with tight timeouts.",
                  "- Read-only: do NOT call grouped_light.set or light.set.",
                  "- Use clipv2.request to read room + device resources.",
                  "- Output only the lamp names, one per line, then final line: ok",
                ].join("\n"),
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

    const bashJoined = extractBashCommands(chunks).join("\n\n");
    expect(bashJoined).toContain("--connect-timeout 1");
    expect(bashJoined).toContain("/readyz");
    expect(bashJoined).toContain("/v1/actions");
    expect(bashJoined).toContain("/clip/v2/resource/");
    expect(bashJoined).not.toContain("grouped_light.set");
    expect(bashJoined).not.toContain("light.set");

    const bashResults = extractBashResults(chunks);
    expect(bashResults.length).toBeGreaterThan(0);
    expect(bashResults.some((r) => r.exitCode === 0)).toBeTruthy();

    const text = getUIMessageStreamText(chunks);
    expect(text).toContain("ok");
    expect(text).toContain(expected[0] ?? "");
  });

  test("does not guess ambiguous room targets", async ({ request }) => {
    test.skip(!ENABLE_DOCKER_SANDBOXD, "Set REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD=1 to run this test.");
    test.skip(!isDockerAvailable(), "Docker is not available (docker info failed).");

    const modelId = await getToolsEnabledModelId(request);
    test.skip(!modelId, "No tools-enabled model found for active provider.");

    const profileId = await createProfile(request);
    const temporarySessionId = `e2e-hue-ambiguous-${Date.now()}`;

    const chatRes = await request.post("/api/chat", {
      data: {
        profileId,
        modelId,
        temporary: true,
        temporarySessionId,
        messages: [
          {
            id: `user-${Date.now()}`,
            role: "user",
            parts: [
              {
                type: "text",
                text: [
                  "/hue-instant-control",
                  "Turn off the lights in hal.",
                  "Do not guess: ask a quick follow-up question instead of executing grouped_light.set.",
                ].join("\n"),
              },
            ],
            metadata: { createdAt: new Date().toISOString() },
          },
        ],
      },
    });

    expect(chatRes.ok()).toBeTruthy();

    const chunks = parseUIMessageStreamChunks(await chatRes.body());
    expect(getUIMessageStreamErrors(chunks)).toEqual([]);

    const bashCommands = extractBashCommands(chunks).join("\n\n");
    expect(bashCommands).not.toContain("grouped_light.set");

    const text = getUIMessageStreamText(chunks);
    expect(text).toMatch(/\?/);
    expect(text.toLowerCase()).toContain("hal");
  });

  test("applies idempotent on/off only for a named room", async ({ request }) => {
    test.skip(!ENABLE_DOCKER_SANDBOXD, "Set REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD=1 to run this test.");
    test.skip(!isDockerAvailable(), "Docker is not available (docker info failed).");

    const health = await fetch(`${HUE_HOST_BASE_URL}/healthz`, { method: "GET" }).catch(() => null);
    test.skip(!health?.ok, `Hue Gateway not reachable at ${HUE_HOST_BASE_URL}`);

    const modelId = await getToolsEnabledModelId(request);
    test.skip(!modelId, "No tools-enabled model found for active provider.");

    const woonkamerRid = await getGroupedLightRidForRoom("Woonkamer");
    const woonkammerOn = await getGroupedLightOnState(woonkamerRid);

    const profileId = await createProfile(request);
    const temporarySessionId = `e2e-hue-idempotent-${Date.now()}`;

    const chatRes = await request.post("/api/chat", {
      data: {
        profileId,
        modelId,
        temporary: true,
        temporarySessionId,
        messages: [
          {
            id: `user-${Date.now()}`,
            role: "user",
            parts: [
              {
                type: "text",
                text: [
                  "/hue-instant-control",
                  `Set Woonkamer on=${woonkammerOn ? "true" : "false"} (idempotent).`,
                  "Constraints:",
                  "- Use bash tool.",
                  "- Do base URL selection + readyz with tight timeouts.",
                  "- Use RID-based grouped_light.set (do NOT use grouped_light name).",
                  "- ONLY set on/off (do not set brightness, xy, or colorTempK).",
                  "Reply with: ok",
                ].join("\n"),
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

    const bashCommands = extractBashCommands(chunks);
    expect(bashCommands.length).toBeGreaterThan(0);
    const bashJoined = bashCommands.join("\n\n");
    expect(bashJoined).toContain("/v1/actions");
    expect(bashJoined).toContain("grouped_light.set");
    expect(bashJoined).toMatch(/grouped_light\.set[\s\S]{0,400}rid/);
    expect(bashJoined).toMatch(/grouped_light\.set[\s\S]{0,400}on/);
    expect(bashJoined).not.toMatch(/\bbrightness\b/);
    expect(bashJoined).not.toMatch(/\bxy\b/);
    expect(bashJoined).not.toMatch(/\bcolorTempK\b/);

    const bashResults = extractBashResults(chunks);
    expect(bashResults.length).toBeGreaterThan(0);
    expect(bashResults.some((r) => r.exitCode === 0)).toBeTruthy();
    expect(getUIMessageStreamText(chunks)).toContain("ok");
  });
});
