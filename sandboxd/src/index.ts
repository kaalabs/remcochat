import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import { Writable } from "node:stream";
import { URL } from "node:url";
import Dockerode from "dockerode";
import { nanoid } from "nanoid";
import tar from "tar-stream";
import { buildPublishedPortUrl } from "./public-url";

type SandboxRuntime = "node24" | "python3.13";

type SandboxEntry = {
  sandboxId: string;
  sessionKey: string;
  runtime: SandboxRuntime;
  containerId: string;
  containerName: string;
  volumeName: string;
  networkMode: "default" | "none";
  ports: number[];
  loopbackProxyPorts: Map<number, number>;
  publishedPorts: Map<number, number>;
  portProxyContainerIds: Map<number, string>;
  createdAt: number;
  lastUsedAt: number;
  idleTtlMs: number;
  idleTimer: NodeJS.Timeout | null;
};

type LogRecord = { stream: "stdout" | "stderr"; data: string };

type CommandEntry = {
  commandId: string;
  sandboxId: string;
  createdAt: number;
  logs: LogRecord[];
  done: Promise<number>;
  exitCode: number | null;
  finishedAt: number | null;
  subscribers: Set<(rec: LogRecord) => void>;
};

function isTruthyEnv(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isLocalhostHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function adminTokenFromRequest(req: http.IncomingMessage): string | null {
  const direct = req.headers["x-remcochat-admin-token"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const authorization = String(req.headers.authorization ?? "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();
  return null;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function notFound(res: http.ServerResponse) {
  json(res, 404, { error: "Not found" });
}

function badRequest(res: http.ServerResponse, message: string) {
  json(res, 400, { error: message });
}

function unauthorized(res: http.ServerResponse) {
  json(res, 401, { error: "Unauthorized" });
}

function serverError(res: http.ServerResponse, message: string) {
  json(res, 500, { error: message });
}

async function readJsonBody(req: http.IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > maxBytes) throw new Error("Request body too large.");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

function safeMs(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function socketPathFromDockerHost(dockerHost: string): string | null {
  const raw = String(dockerHost ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("unix://")) {
    const path = raw.slice("unix://".length).trim();
    return path || null;
  }
  return null;
}

function isUsableUnixSocketPath(candidate: string): boolean {
  const path = String(candidate ?? "").trim();
  if (!path) return false;
  try {
    const st = fs.statSync(path);
    return st.isSocket();
  } catch {
    return false;
  }
}

function resolveDockerSocketPath(): {
  socketPath: string;
  source: string;
  candidates: string[];
} {
  const envSocket = String(process.env.SANDBOXD_DOCKER_SOCKET ?? "").trim();
  if (envSocket) {
    return { socketPath: envSocket, source: "SANDBOXD_DOCKER_SOCKET", candidates: [envSocket] };
  }

  const fromDockerHost = socketPathFromDockerHost(String(process.env.DOCKER_HOST ?? ""));
  if (fromDockerHost) {
    return { socketPath: fromDockerHost, source: "DOCKER_HOST", candidates: [fromDockerHost] };
  }

  const home = os.homedir();
  const candidates = [
    "/var/run/docker.sock",
    `${home}/.docker/run/docker.sock`, // Docker Desktop (macOS)
    `${home}/.orbstack/run/docker.sock`, // OrbStack
    `${home}/.colima/default/docker.sock`, // Colima
    `${home}/.rd/docker.sock`, // Rancher Desktop
  ];

  for (const c of candidates) {
    if (isUsableUnixSocketPath(c)) {
      return { socketPath: c, source: "auto", candidates };
    }
  }

  // Fall back to the conventional Linux path even if unusable, so errors remain actionable.
  return { socketPath: "/var/run/docker.sock", source: "default", candidates };
}

function resolveRuntime(runtime: unknown): SandboxRuntime {
  const value = String(runtime ?? "").trim();
  if (value === "python3.13") return "python3.13";
  return "node24";
}

function resolveImage(runtime: SandboxRuntime): string {
  if (runtime === "python3.13") return "remcochat-sandbox:node24";
  return "remcochat-sandbox:node24";
}

function workspacePrefix(): string {
  return "/vercel/sandbox/workspace";
}

function toWorkspaceRelativeOrThrow(absolutePath: string): string {
  const prefix = workspacePrefix();
  const normalized = String(absolutePath ?? "").trim();
  if (!normalized.startsWith(prefix)) {
    throw new Error(`Path must be under ${prefix}`);
  }
  const rel = normalized.slice(prefix.length).replace(/^\/+/, "");
  if (!rel || rel.includes("..")) throw new Error("Invalid path.");
  return rel;
}

function makeWritable(fn: (chunk: Buffer) => void): Writable {
  return new Writable({
    write(chunk, _enc, cb) {
      try {
        fn(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

function writeNdjson(res: http.ServerResponse, record: LogRecord) {
  res.write(JSON.stringify(record) + "\n");
}

type ServerState = {
  docker: Dockerode;
  bindHost: string;
  bindPort: number;
  requireToken: boolean;
  adminToken: string | null;
  maxConcurrentSandboxes: number;
  defaultIdleTtlMs: number;
  maxBodyBytes: number;
  publishedPortHostIp: string;
  publicHost: string | null;
  publicProto: "http" | "https";
  sandboxNetworkName: string;
  sandboxesById: Map<string, SandboxEntry>;
  sandboxIdBySessionKey: Map<string, string>;
  commandsById: Map<string, CommandEntry>;
};

async function ensureSandboxNetwork(state: ServerState) {
  try {
    await state.docker.createNetwork({
      Name: state.sandboxNetworkName,
      Driver: "bridge",
      CheckDuplicate: true,
      Labels: { "remcochat.system": "sandbox-net" },
    });
  } catch (err) {
    const anyErr = err as { statusCode?: number };
    if (anyErr?.statusCode === 409) return;
    // ignore if the engine doesn't support createNetwork in this context
  }
}

async function ensureImage(state: ServerState, image: string) {
  try {
    await state.docker.getImage(image).inspect();
    return;
  } catch {
    // fall through
  }

  const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    state.docker.pull(image, (err: unknown, s: unknown) => {
      if (err) reject(err);
      else if (!s) reject(new Error("Failed to pull image (no stream)."));
      else resolve(s as NodeJS.ReadableStream);
    });
  });

  await new Promise<void>((resolve, reject) => {
    state.docker.modem.followProgress(stream, (err: unknown) => {
      if (err) reject(err as Error);
      else resolve();
    });
  });
}

async function rehydrateFromEngine(state: ServerState) {
  let containers: Array<{
    Id?: string;
    Names?: string[];
    Created?: number;
    State?: string;
    Labels?: Record<string, string>;
  }> = [];
  try {
    const listed = (await state.docker.listContainers({
      all: true,
      filters: { label: ["remcochat.sandboxId"] },
    } as unknown as Record<string, unknown>)) as unknown;
    containers = Array.isArray(listed) ? (listed as typeof containers) : [];
  } catch {
    return;
  }

  const proxies: Array<{ sandboxId: string; containerId: string; port: number }> = [];
  for (const item of containers) {
    const id = String(item?.Id ?? "").trim();
    const labels = item?.Labels ?? {};
    const sandboxId = String(labels["remcochat.sandboxId"] ?? "").trim();
    if (!id || !sandboxId) continue;
    const isRunning = String(item?.State ?? "") === "running";
    if (!isRunning) continue;

    const proxyPort = String(labels["remcochat.proxyPort"] ?? "").trim();
    if (proxyPort) {
      const port = Number(proxyPort);
      if (Number.isFinite(port) && port > 0) {
        proxies.push({ sandboxId, containerId: id, port });
      }
      continue;
    }

    const sessionKey = String(labels["remcochat.sessionKey"] ?? "").trim();
    if (!sessionKey) continue;

    const runtimeLabel = String(labels["remcochat.runtime"] ?? "").trim();
    const runtime: SandboxRuntime =
      runtimeLabel === "python3.13" ? "python3.13" : "node24";

    const networkModeLabel = String(labels["remcochat.networkMode"] ?? "").trim();
    const networkMode: "default" | "none" =
      networkModeLabel === "none" ? "none" : "default";

    const portsLabel = String(labels["remcochat.ports"] ?? "").trim();
    const ports = portsLabel
      ? Array.from(
          new Set(
            portsLabel
              .split(",")
              .map((p) => Math.floor(Number(p.trim())))
              .filter((p) => Number.isFinite(p) && p >= 1 && p <= 65535)
          )
        ).slice(0, 4)
      : [];

    const createdAt = Math.max(0, Math.floor(Number(item?.Created ?? 0) * 1000));
    const entry: SandboxEntry = {
      sandboxId,
      sessionKey,
      runtime,
      containerId: id,
      containerName: String((item?.Names ?? [])[0] ?? `remcochat-sandbox-${sandboxId}`),
      volumeName: `remcochat-sandbox-ws-${sandboxId}`,
      networkMode,
      ports,
      loopbackProxyPorts: new Map(),
      publishedPorts: new Map(),
      portProxyContainerIds: new Map(),
      createdAt: createdAt || Date.now(),
      lastUsedAt: Date.now(),
      idleTtlMs: state.defaultIdleTtlMs,
      idleTimer: null,
    };
    state.sandboxesById.set(sandboxId, entry);
    state.sandboxIdBySessionKey.set(sessionKey, sandboxId);
    touchSandbox(state, entry);
  }

  for (const proxy of proxies) {
    const sandbox = state.sandboxesById.get(proxy.sandboxId);
    if (!sandbox) continue;
    if (!sandbox.ports.includes(proxy.port) && sandbox.ports.length < 4) {
      sandbox.ports.push(proxy.port);
    }
    sandbox.portProxyContainerIds.set(proxy.port, proxy.containerId);
    try {
      const info = await state.docker.getContainer(proxy.containerId).inspect();
      const binding = (info?.NetworkSettings?.Ports?.[`${proxy.port}/tcp`] ?? [])[0];
      const hostPortRaw = binding?.HostPort ? Number(binding.HostPort) : NaN;
      if (Number.isFinite(hostPortRaw) && hostPortRaw > 0) {
        sandbox.publishedPorts.set(proxy.port, hostPortRaw);
      }
    } catch {
      // ignore
    }
  }
}

async function inspectSandboxHealthy(state: ServerState, sandbox: SandboxEntry): Promise<boolean> {
  try {
    const info = await state.docker.getContainer(sandbox.containerId).inspect();
    return Boolean(info?.State?.Running);
  } catch {
    return false;
  }
}

async function stopSandbox(state: ServerState, sandboxId: string) {
  const sandbox = state.sandboxesById.get(sandboxId);
  if (!sandbox) return;
  if (sandbox.idleTimer) clearTimeout(sandbox.idleTimer);

  state.sandboxesById.delete(sandboxId);
  state.sandboxIdBySessionKey.delete(sandbox.sessionKey);

  for (const [commandId, cmd] of state.commandsById.entries()) {
    if (cmd.sandboxId !== sandboxId) continue;
    state.commandsById.delete(commandId);
  }

  for (const proxyId of sandbox.portProxyContainerIds.values()) {
    try {
      await state.docker.getContainer(proxyId).remove({ force: true });
    } catch {
      // ignore
    }
  }

  const container = state.docker.getContainer(sandbox.containerId);
  try {
    await container.remove({ force: true });
  } catch {
    // ignore
  }

  try {
    await state.docker.getVolume(sandbox.volumeName).remove();
  } catch {
    // ignore
  }
}

async function evictIfNeeded(state: ServerState) {
  while (state.sandboxesById.size >= state.maxConcurrentSandboxes) {
    const entries = Array.from(state.sandboxesById.values());
    entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const oldest = entries[0];
    if (!oldest) return;
    await stopSandbox(state, oldest.sandboxId);
  }
}

function touchSandbox(state: ServerState, sandbox: SandboxEntry) {
  sandbox.lastUsedAt = Date.now();
  if (sandbox.idleTimer) clearTimeout(sandbox.idleTimer);
  sandbox.idleTimer = setTimeout(() => {
    stopSandbox(state, sandbox.sandboxId).catch(() => {});
  }, sandbox.idleTtlMs);
}

async function createSandbox(state: ServerState, input: {
  sessionKey: string;
  runtime: SandboxRuntime;
  idleTtlMs: number;
  resources: { vcpus: number; memoryMb: number };
  networkMode: "default" | "none";
  ports: number[];
}): Promise<SandboxEntry> {
  await evictIfNeeded(state);

  const sandboxId = nanoid();
  const containerName = `remcochat-sandbox-${sandboxId}`;
  const volumeName = `remcochat-sandbox-ws-${sandboxId}`;

  await state.docker.createVolume({
    Name: volumeName,
    Labels: {
      "remcochat.sandboxId": sandboxId,
      "remcochat.sessionKey": input.sessionKey,
      "remcochat.runtime": input.runtime,
    },
  });

  const image = resolveImage(input.runtime);
  if (input.networkMode === "default") {
    await ensureSandboxNetwork(state);
  }
  const networkMode =
    input.networkMode === "none" ? "none" : state.sandboxNetworkName;
  const container = await state.docker.createContainer({
    name: containerName,
    Image: image,
    WorkingDir: workspacePrefix(),
    Env: [
      `HOME=${workspacePrefix()}`,
      "TERM=xterm-256color",
    ],
    Cmd: ["bash", "-lc", "sleep infinity"],
    Labels: {
      "remcochat.sandboxId": sandboxId,
      "remcochat.sessionKey": input.sessionKey,
      "remcochat.runtime": input.runtime,
      "remcochat.ports": input.ports.join(","),
      "remcochat.networkMode": input.networkMode,
    },
    HostConfig: {
      AutoRemove: false,
      ReadonlyRootfs: true,
      Init: true,
      NetworkMode: networkMode,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      PidsLimit: 512,
      NanoCpus: input.resources.vcpus * 1_000_000_000,
      Memory: input.resources.memoryMb * 1024 * 1024,
      Mounts: [
        {
          Type: "volume",
          Source: volumeName,
          Target: workspacePrefix(),
        },
      ],
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,size=128m",
      },
    },
  });

  await container.start();

  const publishedPorts = new Map<number, number>();
  const portProxyContainerIds = new Map<number, string>();

  const entry: SandboxEntry = {
    sandboxId,
    sessionKey: input.sessionKey,
    runtime: input.runtime,
    containerId: container.id,
    containerName,
    volumeName,
    networkMode: input.networkMode,
    ports: input.ports,
    loopbackProxyPorts: new Map(),
    publishedPorts,
    portProxyContainerIds,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    idleTtlMs: input.idleTtlMs,
    idleTimer: null,
  };
  touchSandbox(state, entry);
  state.sandboxesById.set(sandboxId, entry);
  state.sandboxIdBySessionKey.set(input.sessionKey, sandboxId);
  return entry;
}

async function ensureSandboxConnected(state: ServerState, sandbox: SandboxEntry) {
  if (sandbox.networkMode !== "default") return;
  await ensureSandboxNetwork(state);
  try {
    const info = await state.docker.getContainer(sandbox.containerId).inspect();
    const networks = info?.NetworkSettings?.Networks ?? {};
    if (networks && typeof networks === "object" && state.sandboxNetworkName in networks) {
      return;
    }
  } catch {
    // ignore
  }
  try {
    await state.docker.getNetwork(state.sandboxNetworkName).connect({
      Container: sandbox.containerId,
      EndpointConfig: {
        Aliases: [sandbox.containerName],
      },
    });
  } catch {
    // ignore
  }
}

async function ensureLoopbackProxyPort(
  state: ServerState,
  sandbox: SandboxEntry,
  port: number
): Promise<number> {
  const existing = sandbox.loopbackProxyPorts.get(port);
  if (existing) return existing;

  const base = 20_000 + (port % 10_000);
  const candidates = [
    base,
    base + 1,
    base + 2,
    base + 10,
    base + 100,
    base + 1000,
  ].filter((p) => p >= 1024 && p <= 65535);

  const script = [
    `set -e`,
    `target_port="${port}"`,
    `pidfile="/tmp/remcochat-loopback-proxy-${port}.pid"`,
    `portfile="/tmp/remcochat-loopback-proxy-${port}.port"`,
    `if [ -f "$portfile" ]; then`,
    `  p="$(cat "$portfile" || true)"`,
    `  if [ -n "$p" ]; then echo "$p"; exit 0; fi`,
    `fi`,
    `for p in ${candidates.map((p) => String(p)).join(" ")}; do`,
    `  rm -f "$pidfile" "$portfile" || true`,
    `  ( socat "TCP-LISTEN:${"$"}p,fork,reuseaddr" "TCP:127.0.0.1:${"$"}target_port" >/tmp/remcochat-loopback-proxy-${port}.log 2>&1 & echo ${"$"}! > "$pidfile" )`,
    `  sleep 0.05`,
    `  pid="$(cat "$pidfile" 2>/dev/null || true)"`,
    `  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then`,
    `    echo "$p" > "$portfile"`,
    `    echo "$p"`,
    `    exit 0`,
    `  fi`,
    `done`,
    `echo "Failed to start loopback proxy for port ${port}" >&2`,
    `exit 1`,
  ].join("\n");

  const container = state.docker.getContainer(sandbox.containerId);
  const exec = await container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Cmd: ["bash", "-lc", script],
    WorkingDir: workspacePrefix(),
  });

  const stream = await exec.start({ hijack: true, stdin: false });
  let stdout = "";
  let stderr = "";
  const stdoutWritable = makeWritable((chunk) => {
    stdout += chunk.toString("utf8");
  });
  const stderrWritable = makeWritable((chunk) => {
    stderr += chunk.toString("utf8");
  });
  state.docker.modem.demuxStream(stream, stdoutWritable, stderrWritable);
  await new Promise<void>((resolve) => {
    stream.on("end", () => resolve());
    stream.on("close", () => resolve());
    stream.on("error", () => resolve());
  });

  const info = await exec.inspect();
  if (typeof info.ExitCode === "number" && info.ExitCode !== 0) {
    throw new Error(
      `Failed to start loopback proxy for port ${port}. ${stderr || stdout}`.trim()
    );
  }

  const chosen = Number(String(stdout).trim().split(/\s+/)[0] ?? "");
  if (!Number.isFinite(chosen) || chosen <= 0) {
    throw new Error(`Failed to resolve loopback proxy port for ${port}.`);
  }
  sandbox.loopbackProxyPorts.set(port, chosen);
  return chosen;
}

async function ensurePortPublished(state: ServerState, sandbox: SandboxEntry, port: number): Promise<number> {
  const existing = sandbox.publishedPorts.get(port);
  if (existing) return existing;

  if (!sandbox.ports.includes(port)) {
    throw new Error(
      `Port ${port} is not enabled for this sandbox. Set ports=[${port}] when creating the sandbox.`
    );
  }
  if (sandbox.networkMode !== "default") {
    throw new Error(
      "Port publishing requires network.mode=\"default\" (networking enabled)."
    );
  }
  await ensureSandboxConnected(state, sandbox);
  await ensureSandboxNetwork(state);

  const targetPort = await ensureLoopbackProxyPort(state, sandbox, port);

  const proxyName = `remcochat-sandbox-proxy-${sandbox.sandboxId}-${port}`;
  let proxy: Dockerode.Container;
  try {
    await ensureImage(state, "alpine/socat:latest");
    proxy = await state.docker.createContainer({
      name: proxyName,
      Image: "alpine/socat:latest",
      Cmd: [
        `TCP-LISTEN:${port},fork,reuseaddr`,
        `TCP:${sandbox.containerName}:${targetPort}`,
      ],
      Labels: {
        "remcochat.sandboxId": sandbox.sandboxId,
        "remcochat.sessionKey": sandbox.sessionKey,
        "remcochat.proxyPort": String(port),
      },
      ExposedPorts: {
        [`${port}/tcp`]: {},
      },
      HostConfig: {
        AutoRemove: false,
        NetworkMode: state.sandboxNetworkName,
        PortBindings: {
          [`${port}/tcp`]: [{ HostIp: state.publishedPortHostIp, HostPort: "0" }],
        },
      },
    });
  } catch (err) {
    const anyErr = err as { statusCode?: number };
    if (anyErr?.statusCode === 404) {
      await ensureImage(state, "alpine/socat:latest");
      proxy = await state.docker.createContainer({
        name: proxyName,
        Image: "alpine/socat:latest",
        Cmd: [
          `TCP-LISTEN:${port},fork,reuseaddr`,
          `TCP:${sandbox.containerName}:${targetPort}`,
        ],
        Labels: {
          "remcochat.sandboxId": sandbox.sandboxId,
          "remcochat.sessionKey": sandbox.sessionKey,
          "remcochat.proxyPort": String(port),
        },
        ExposedPorts: {
          [`${port}/tcp`]: {},
        },
        HostConfig: {
          AutoRemove: false,
          NetworkMode: state.sandboxNetworkName,
          PortBindings: {
            [`${port}/tcp`]: [{ HostIp: state.publishedPortHostIp, HostPort: "0" }],
          },
        },
      });
    } else
    if (anyErr?.statusCode === 409) {
      proxy = state.docker.getContainer(proxyName);
    } else {
      throw err;
    }
  }

  await proxy.start();
  const info = await proxy.inspect();
  const binding = (info?.NetworkSettings?.Ports?.[`${port}/tcp`] ?? [])[0];
  const hostPortRaw = binding?.HostPort ? Number(binding.HostPort) : NaN;
  if (!Number.isFinite(hostPortRaw) || hostPortRaw <= 0) {
    throw new Error(`Failed to publish sandbox port ${port}.`);
  }

  sandbox.publishedPorts.set(port, hostPortRaw);
  sandbox.portProxyContainerIds.set(port, proxy.id);
  return hostPortRaw;
}

function extractBashScriptOrThrow(cmd: unknown, args: unknown): string {
  if (String(cmd ?? "") !== "bash") throw new Error("Only cmd=\"bash\" is supported.");
  if (!Array.isArray(args)) throw new Error("args must be an array.");
  const idx = args.findIndex((a) => String(a) === "-lc");
  const script = idx >= 0 ? args[idx + 1] : null;
  if (typeof script !== "string") throw new Error("bash args must include -lc <script>.");
  return script;
}

function makeCommandWrapper(opts: {
  commandId: string;
  script: string;
  timeoutMs: number;
}): string {
  const pidFile = `/tmp/remcochat-cmd-${opts.commandId}.pid`;
  const scriptB64 = Buffer.from(String(opts.script ?? ""), "utf8").toString("base64");
  const timeoutSec = Math.max(0, Math.ceil(opts.timeoutMs / 1000));

  return [
    `set -euo pipefail`,
    `cd "${workspacePrefix()}"`,
    `pidfile="${pidFile}"`,
    `rm -f "$pidfile"`,
    `cleanup(){ rm -f "$pidfile" || true; }`,
    `trap cleanup EXIT`,
    `script_b64="${scriptB64}"`,
    `script="$(printf %s "$script_b64" | base64 -d)"`,
    `if [ "${timeoutSec}" -gt 0 ]; then`,
    `  ( timeout -s TERM -k 2s "${timeoutSec}s" bash -lc "$script" ) &`,
    `else`,
    `  ( bash -lc "$script" ) &`,
    `fi`,
    `pid=$!`,
    `echo "$pid" > "$pidfile"`,
    `wait "$pid"`,
    `exit "$?"`,
  ].join("\n");
}

async function startCommand(state: ServerState, sandbox: SandboxEntry, input: {
  cmd: string;
  args: string[];
  timeoutMs: number;
}): Promise<CommandEntry> {
  const script = extractBashScriptOrThrow(input.cmd, input.args);
  const commandId = nanoid();
  const wrapper = makeCommandWrapper({ commandId, script, timeoutMs: input.timeoutMs });

  const container = state.docker.getContainer(sandbox.containerId);
  const exec = await container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Cmd: ["bash", "-lc", wrapper],
    WorkingDir: workspacePrefix(),
  });

  const subscribers = new Set<(rec: LogRecord) => void>();
  const logs: LogRecord[] = [];
  const push = (rec: LogRecord) => {
    logs.push(rec);
    for (const cb of subscribers) {
      try {
        cb(rec);
      } catch {
        // ignore
      }
    }
    const maxRecords = 50_000;
    if (logs.length > maxRecords) logs.splice(0, logs.length - maxRecords);
  };

  const stdoutWritable = makeWritable((chunk) => push({ stream: "stdout", data: chunk.toString("utf8") }));
  const stderrWritable = makeWritable((chunk) => push({ stream: "stderr", data: chunk.toString("utf8") }));

  const done = (async () => {
    const stream = await exec.start({ hijack: true, stdin: false });
    state.docker.modem.demuxStream(stream, stdoutWritable, stderrWritable);
    await new Promise<void>((resolve, reject) => {
      stream.on("end", () => resolve());
      stream.on("close", () => resolve());
      stream.on("error", (err) => reject(err));
    });
    const info = await exec.inspect();
    const exit = typeof info.ExitCode === "number" ? info.ExitCode : 1;
    return exit;
  })();

  const entry: CommandEntry = {
    commandId,
    sandboxId: sandbox.sandboxId,
    createdAt: Date.now(),
    logs,
    done: done.then((exit) => {
      entry.exitCode = exit;
      entry.finishedAt = Date.now();
      return exit;
    }),
    exitCode: null,
    finishedAt: null,
    subscribers,
  };

  state.commandsById.set(commandId, entry);
  return entry;
}

async function killCommand(state: ServerState, sandbox: SandboxEntry, commandId: string) {
  const pidFile = `/tmp/remcochat-cmd-${commandId}.pid`;
  const container = state.docker.getContainer(sandbox.containerId);
  const exec = await container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Cmd: [
      "bash",
      "-lc",
      [
        `set -e`,
        `if [ -f "${pidFile}" ]; then`,
        `  pid="$(cat "${pidFile}" || true)"`,
        `  if [ -n "$pid" ]; then kill -TERM "$pid" || true; fi`,
        `fi`,
      ].join("\n"),
    ],
    WorkingDir: workspacePrefix(),
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  await new Promise<void>((resolve) => {
    stream.on("end", () => resolve());
    stream.on("close", () => resolve());
    stream.on("error", () => resolve());
  });
}

async function writeFiles(state: ServerState, sandbox: SandboxEntry, files: Array<{ path: string; contentBase64: string }>) {
  const pack = tar.pack();
  for (const file of files) {
    const rel = toWorkspaceRelativeOrThrow(file.path);
    const content = Buffer.from(String(file.contentBase64 ?? ""), "base64");
    pack.entry({ name: rel, type: "file", mode: 0o644 }, content);
  }
  pack.finalize();

  const container = state.docker.getContainer(sandbox.containerId);
  await new Promise<void>((resolve, reject) => {
    container.putArchive(pack, { path: workspacePrefix() }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function readFileFromSandbox(state: ServerState, sandbox: SandboxEntry, absolutePath: string): Promise<Buffer | null> {
  toWorkspaceRelativeOrThrow(absolutePath);
  const container = state.docker.getContainer(sandbox.containerId);

  let archive: NodeJS.ReadableStream;
  try {
    archive = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      container.getArchive({ path: absolutePath }, (err, stream) => {
        if (err) reject(err);
        else if (!stream) reject(new Error("Failed to open archive stream."));
        else resolve(stream);
      });
    });
  } catch (err) {
    const anyErr = err as { statusCode?: number };
    if (anyErr?.statusCode === 404) return null;
    throw err;
  }

  const extract = tar.extract();
  const chunks: Buffer[] = [];
  let sawFile = false;
  const done = new Promise<Buffer | null>((resolve, reject) => {
    extract.on("entry", (_header, stream, next) => {
      sawFile = true;
      stream.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      stream.on("end", () => {
        next();
      });
      stream.on("error", (e) => reject(e));
    });
    extract.on("finish", () => {
      if (!sawFile) resolve(null);
      else resolve(Buffer.concat(chunks));
    });
    extract.on("error", (e) => reject(e));
  });

  archive.pipe(extract);
  return await done;
}

function mustAuth(state: ServerState, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!state.requireToken) return true;
  const required = state.adminToken;
  if (!required) {
    unauthorized(res);
    return false;
  }
  const provided = adminTokenFromRequest(req);
  if (!provided || provided !== required) {
    unauthorized(res);
    return false;
  }
  return true;
}

function parsePathname(reqUrl: string | undefined): { pathname: string; searchParams: URLSearchParams } {
  const url = new URL(reqUrl ?? "/", "http://localhost");
  return { pathname: url.pathname, searchParams: url.searchParams };
}

async function main() {
  const bindHost = String(process.env.SANDBOXD_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const bindPort = safeMs(process.env.SANDBOXD_PORT, 8080, 1, 65535);
  const adminToken = String(process.env.SANDBOXD_ADMIN_TOKEN ?? "").trim() || null;
  const maxConcurrentSandboxes = safeMs(process.env.SANDBOXD_MAX_CONCURRENT, 2, 1, 10);
  const defaultIdleTtlMs = safeMs(process.env.SANDBOXD_DEFAULT_IDLE_TTL_MS, 15 * 60_000, 10_000, 6 * 60 * 60_000);
  const maxBodyBytes = safeMs(process.env.SANDBOXD_MAX_BODY_BYTES, 50 * 1024 * 1024, 1024, 200 * 1024 * 1024);
  const resolvedSocket = resolveDockerSocketPath();
  const socketPath = resolvedSocket.socketPath;
  const requireToken =
    !isLocalhostHost(bindHost) &&
    (isTruthyEnv(process.env.SANDBOXD_REQUIRE_TOKEN) || true);
  const publishedPortHostIp =
    String(process.env.SANDBOXD_PUBLISH_HOST_IP ?? "").trim() ||
    (isLocalhostHost(bindHost) ? "127.0.0.1" : "0.0.0.0");
  const publicHost = String(process.env.SANDBOXD_PUBLIC_HOST ?? "").trim() || null;
  const publicProtoEnv = String(process.env.SANDBOXD_PUBLIC_PROTO ?? "").trim().toLowerCase();
  const publicProto: "http" | "https" = publicProtoEnv === "https" ? "https" : "http";
  const sandboxNetworkName =
    String(process.env.SANDBOXD_NETWORK_NAME ?? "").trim() || "remcochat-sandbox-net";

  const state: ServerState = {
    docker: new Dockerode({ socketPath }),
    bindHost,
    bindPort,
    requireToken,
    adminToken,
    maxConcurrentSandboxes,
    defaultIdleTtlMs,
    maxBodyBytes,
    publishedPortHostIp,
    publicHost,
    publicProto,
    sandboxNetworkName,
    sandboxesById: new Map(),
    sandboxIdBySessionKey: new Map(),
    commandsById: new Map(),
  };

  if (resolvedSocket.source === "auto") {
    console.log(`[sandboxd] docker socket: ${socketPath} (auto-detected)`);
  } else if (resolvedSocket.source === "default") {
    console.warn(
      `[sandboxd] docker socket not found at known locations; defaulting to ${socketPath}. ` +
        `Set SANDBOXD_DOCKER_SOCKET (or DOCKER_HOST=unix://...) to a valid socket.`,
    );
  } else {
    console.log(`[sandboxd] docker socket: ${socketPath} (${resolvedSocket.source})`);
  }

  await ensureSandboxNetwork(state);
  await rehydrateFromEngine(state);

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) return notFound(res);
      const { pathname, searchParams } = parsePathname(req.url);

      if (pathname === "/v1/health" && req.method === "GET") {
        const version = await state.docker.version();
        return json(res, 200, {
          ok: true,
          engine: "docker",
          version: String((version as { Version?: string })?.Version ?? ""),
        });
      }

      if (!mustAuth(state, req, res)) return;

      if (pathname === "/v1/sandboxes" && req.method === "POST") {
        const body = (await readJsonBody(req, state.maxBodyBytes)) as unknown;
        const bodyObj = isRecord(body) ? body : {};
        const sessionKey = String(bodyObj.sessionKey ?? "").trim();
        if (!sessionKey) return badRequest(res, "sessionKey is required.");

        const runtime = resolveRuntime(bodyObj.runtime);
        const idleTtlMs = safeMs(bodyObj.idleTtlMs, state.defaultIdleTtlMs, 10_000, 6 * 60 * 60_000);
        const resources = isRecord(bodyObj.resources) ? bodyObj.resources : {};
        const vcpus = safeMs(resources.vcpus, 2, 1, 8);
        const memoryMb = safeMs(resources.memoryMb, 2048, 256, 16_384);
        const network = isRecord(bodyObj.network) ? bodyObj.network : {};
        const networkMode = String(network.mode ?? "default").trim() === "none" ? "none" : "default";
        const portsRaw = bodyObj.ports;
        const ports = Array.isArray(portsRaw)
          ? Array.from(
              new Set(
                portsRaw
                  .map((p) => Math.floor(Number(p)))
                  .filter((p) => Number.isFinite(p) && p >= 1 && p <= 65535)
              )
            ).slice(0, 4)
          : [];

        const existingId = state.sandboxIdBySessionKey.get(sessionKey) ?? null;
        if (existingId) {
          const existing = state.sandboxesById.get(existingId) ?? null;
          if (existing && (await inspectSandboxHealthy(state, existing))) {
            for (const port of ports) {
              await ensurePortPublished(state, existing, port);
            }
            existing.idleTtlMs = idleTtlMs;
            touchSandbox(state, existing);
            return json(res, 200, { sandboxId: existing.sandboxId, created: false });
          }
          if (existing) await stopSandbox(state, existing.sandboxId);
        }

        const created = await createSandbox(state, {
          sessionKey,
          runtime,
          idleTtlMs,
          resources: { vcpus, memoryMb },
          networkMode,
          ports,
        });
        return json(res, 200, { sandboxId: created.sandboxId, created: true });
      }

      const mCreateCmd = pathname.match(/^\/v1\/sandboxes\/([^/]+)\/commands$/);
      if (mCreateCmd && req.method === "POST") {
        const sandboxId = mCreateCmd[1]!;
        const sandbox = state.sandboxesById.get(sandboxId) ?? null;
        if (!sandbox) return notFound(res);
        if (!(await inspectSandboxHealthy(state, sandbox))) {
          await stopSandbox(state, sandboxId);
          return notFound(res);
        }

        const body = (await readJsonBody(req, state.maxBodyBytes)) as unknown;
        const bodyObj = isRecord(body) ? body : {};
        const cmd = String(bodyObj.cmd ?? "");
        const argsRaw = bodyObj.args;
        const args = Array.isArray(argsRaw) ? argsRaw.map((a) => String(a)) : [];
        const timeoutMs = safeMs(bodyObj.timeoutMs, 30_000, 1_000, 5 * 60_000);

        touchSandbox(state, sandbox);
        const entry = await startCommand(state, sandbox, { cmd, args, timeoutMs });
        return json(res, 200, { commandId: entry.commandId });
      }

      const mWait = pathname.match(/^\/v1\/sandboxes\/([^/]+)\/commands\/([^/]+)\/wait$/);
      if (mWait && req.method === "GET") {
        const sandboxId = mWait[1]!;
        const commandId = mWait[2]!;
        const sandbox = state.sandboxesById.get(sandboxId) ?? null;
        if (!sandbox) return notFound(res);
        const cmd = state.commandsById.get(commandId) ?? null;
        if (!cmd || cmd.sandboxId !== sandboxId) return notFound(res);
        touchSandbox(state, sandbox);
        const exitCode = await cmd.done;
        return json(res, 200, { exitCode });
      }

      const mLogs = pathname.match(/^\/v1\/sandboxes\/([^/]+)\/commands\/([^/]+)\/logs$/);
      if (mLogs && req.method === "GET") {
        const sandboxId = mLogs[1]!;
        const commandId = mLogs[2]!;
        const sandbox = state.sandboxesById.get(sandboxId) ?? null;
        if (!sandbox) return notFound(res);
        const cmd = state.commandsById.get(commandId) ?? null;
        if (!cmd || cmd.sandboxId !== sandboxId) return notFound(res);
        touchSandbox(state, sandbox);

        res.statusCode = 200;
        res.setHeader("content-type", "application/x-ndjson; charset=utf-8");

        for (const rec of cmd.logs) writeNdjson(res, rec);

        let closed = false;
        const onClose = () => {
          closed = true;
          cmd.subscribers.delete(onLog);
        };
        const onLog = (rec: LogRecord) => {
          if (closed) return;
          writeNdjson(res, rec);
        };
        res.on("close", onClose);
        res.on("finish", onClose);
        cmd.subscribers.add(onLog);

        cmd.done
          .then(() => {
            if (!closed) res.end();
          })
          .catch(() => {
            if (!closed) res.end();
          });
        return;
      }

      const mKill = pathname.match(/^\/v1\/sandboxes\/([^/]+)\/commands\/([^/]+):kill$/);
      if (mKill && req.method === "POST") {
        const sandboxId = mKill[1]!;
        const commandId = mKill[2]!;
        const sandbox = state.sandboxesById.get(sandboxId) ?? null;
        if (!sandbox) return notFound(res);
        touchSandbox(state, sandbox);
        await killCommand(state, sandbox, commandId);
        return json(res, 200, { ok: true });
      }

      const mWrite = pathname.match(/^\/v1\/sandboxes\/([^/]+)\/files:write$/);
      if (mWrite && req.method === "POST") {
        const sandboxId = mWrite[1]!;
        const sandbox = state.sandboxesById.get(sandboxId) ?? null;
        if (!sandbox) return notFound(res);
        if (!(await inspectSandboxHealthy(state, sandbox))) {
          await stopSandbox(state, sandboxId);
          return notFound(res);
        }
        const body = (await readJsonBody(req, state.maxBodyBytes)) as unknown;
        const bodyObj = isRecord(body) ? body : {};
        const filesRaw = bodyObj.files;
        const files = Array.isArray(filesRaw) ? filesRaw : [];
        const parsed = files.map((item) => {
          const rec = isRecord(item) ? item : {};
          return {
            path: String(rec.path ?? ""),
            contentBase64: String(rec.contentBase64 ?? ""),
          };
        });
        if (parsed.length === 0) return badRequest(res, "files is required.");
        touchSandbox(state, sandbox);
        await writeFiles(state, sandbox, parsed);
        return json(res, 200, { ok: true });
      }

      const mRead = pathname.match(/^\/v1\/sandboxes\/([^/]+)\/files:read$/);
      if (mRead && req.method === "GET") {
        const sandboxId = mRead[1]!;
        const sandbox = state.sandboxesById.get(sandboxId) ?? null;
        if (!sandbox) return notFound(res);
        if (!(await inspectSandboxHealthy(state, sandbox))) {
          await stopSandbox(state, sandboxId);
          return notFound(res);
        }
        const filePath = String(searchParams.get("path") ?? "").trim();
        if (!filePath) return badRequest(res, "path is required.");
        touchSandbox(state, sandbox);
        const buf = await readFileFromSandbox(state, sandbox, filePath);
        if (!buf) return json(res, 200, { found: false });
        return json(res, 200, { found: true, contentBase64: buf.toString("base64") });
      }

      const mStop = pathname.match(/^\/v1\/sandboxes\/([^/]+):stop$/);
      if (mStop && req.method === "POST") {
        const sandboxId = mStop[1]!;
        await stopSandbox(state, sandboxId);
        return json(res, 200, { ok: true });
      }

      const mPort = pathname.match(/^\/v1\/sandboxes\/([^/]+)\/ports\/(\d+)$/);
      if (mPort && req.method === "GET") {
        const sandboxId = mPort[1]!;
        const port = Number(mPort[2]);
        const sandbox = state.sandboxesById.get(sandboxId) ?? null;
        if (!sandbox) return notFound(res);
        if (!sandbox.ports.includes(port)) return json(res, 200, { found: false });
        const hostPort = await ensurePortPublished(state, sandbox, port);

        const url = buildPublishedPortUrl({
          hostHeader: req.headers.host ? String(req.headers.host) : null,
          bindHost: state.bindHost,
          publishedPortHostIp: state.publishedPortHostIp,
          hostPort,
          publicHost: state.publicHost,
          publicProto: state.publicProto,
        });
        return json(res, 200, {
          found: true,
          hostPort,
          url,
        });
      }

      return notFound(res);
    } catch (err) {
      console.error("[sandboxd] error:", err);
      return serverError(res, err instanceof Error ? err.message : "Internal error.");
    }
  });

  server.listen(state.bindPort, state.bindHost, () => {
    const host = state.bindHost;
    const port = state.bindPort;
    console.log(`[sandboxd] listening on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error("[sandboxd] failed to start:", err);
  process.exit(1);
});
