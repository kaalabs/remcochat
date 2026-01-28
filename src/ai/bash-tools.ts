import type { Command as VercelCommand, Sandbox as VercelSandbox } from "@vercel/sandbox";
import type { Sandbox as BashToolSandbox } from "bash-tool";
import { createDockerSandboxClient } from "@/ai/docker-sandbox-client";
import type { RemcoChatConfig } from "@/server/config";
import { getConfig } from "@/server/config";
import { tool as createTool } from "ai";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

let cachedBashToolModule:
  | Promise<{
      createBashTool: typeof import("bash-tool")["createBashTool"];
    }>
  | null = null;

let cachedVercelSandboxModule:
  | Promise<{
      Sandbox: typeof import("@vercel/sandbox")["Sandbox"];
    }>
  | null = null;

async function loadBashTool() {
  if (!cachedBashToolModule) {
    cachedBashToolModule = import("bash-tool") as Promise<{
      createBashTool: typeof import("bash-tool")["createBashTool"];
    }>;
  }
  return await cachedBashToolModule;
}

async function loadVercelSandbox() {
  if (!cachedVercelSandboxModule) {
    cachedVercelSandboxModule = import("@vercel/sandbox") as Promise<{
      Sandbox: typeof import("@vercel/sandbox")["Sandbox"];
    }>;
  }
  return await cachedVercelSandboxModule;
}

export type BashToolsResult = {
  enabled: boolean;
  tools: Record<string, unknown>;
};

export type ExplicitBashCommandResult = {
  enabled: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};

type SandboxEntry = {
  provider: "vercel" | "docker";
  key: string;
  sandbox?: VercelSandbox;
  sandboxId?: string;
  dockerClient?: ReturnType<typeof createDockerSandboxClient>;
  createdAt: number;
  lastUsedAt: number;
  idleTimer: NodeJS.Timeout | null;
};

const sandboxesByKey = new Map<string, SandboxEntry>();
const createLocks = new Map<string, Promise<SandboxEntry>>();

function isTruthyEnv(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function sandboxCredentialsFromEnv():
  | { token: string; teamId: string; projectId: string }
  | null {
  const token = String(
    process.env.VERCEL_TOKEN ?? process.env.VERCEL_API_KEY ?? ""
  ).trim();
  const teamId = String(
    process.env.VERCEL_TEAM_ID ?? process.env.VERCEL_ORG_ID ?? ""
  ).trim();
  const projectId = String(process.env.VERCEL_PROJECT_ID ?? "").trim();

  if (!token || !teamId || !projectId) return null;
  return { token, teamId, projectId };
}

function bashToolsKillSwitchEnabled(): boolean {
  return isTruthyEnv(process.env.REMCOCHAT_ENABLE_BASH_TOOL);
}

function hostnameFromHostHeader(host: string): string {
  const trimmed = String(host ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end > 0) return trimmed.slice(0, end + 1);
  }
  return trimmed.split(":")[0] ?? "";
}

function isLocalhostRequest(req: Request): boolean {
  const hostHeader = req.headers.get("host") ?? "";
  const host = hostnameFromHostHeader(hostHeader).toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim().toLowerCase();
    if (first === "127.0.0.1" || first === "::1") return true;
  }
  const realIp = req.headers.get("x-real-ip")?.trim().toLowerCase();
  if (realIp === "127.0.0.1" || realIp === "::1") return true;

  return false;
}

function adminTokenFromRequest(req: Request): string | null {
  const direct = req.headers.get("x-remcochat-admin-token");
  if (direct && direct.trim()) return direct.trim();

  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();
  return null;
}

function isRequestAllowedByAccessPolicy(
  req: Request,
  cfg: NonNullable<RemcoChatConfig["bashTools"]>
): boolean {
  if (cfg.access === "localhost") return isLocalhostRequest(req);

  const required = String(process.env.REMCOCHAT_ADMIN_TOKEN ?? "").trim();
  if (!required) return false;
  const provided = adminTokenFromRequest(req);
  return Boolean(provided && provided === required);
}

function truncateWithNotice(
  value: string,
  maxChars: number,
  streamName: "stdout" | "stderr"
): string {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  const removed = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[${streamName} truncated: ${removed} characters removed]`;
}

async function readStreamToString(stream: unknown): Promise<string> {
  if (!stream) return "";

  const maybeWeb = stream as { getReader?: unknown };
  if (typeof maybeWeb.getReader === "function") {
    return await new Response(stream as ReadableStream<Uint8Array>).text();
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }
    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    chunks.push(Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function wrapSandboxCommand(userCommand: string): string {
  const prelude = [
    `export PATH="/vercel/sandbox/workspace/.remcochat/bin:$PATH"`,
    `if ! command -v python >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then`,
    `  mkdir -p /vercel/sandbox/workspace/.remcochat/bin`,
    `  ln -sf "$(command -v python3)" /vercel/sandbox/workspace/.remcochat/bin/python`,
    `fi`,
  ].join("\n");
  return `${prelude}\n${String(userCommand ?? "")}`;
}

function appendTailBuffer(
  buffer: string,
  delta: string,
  maxChars: number
): { buffer: string; dropped: number } {
  const chunk = String(delta ?? "");
  if (!chunk) return { buffer, dropped: 0 };
  if (maxChars <= 0) return { buffer: "", dropped: chunk.length };

  const next = buffer + chunk;
  if (next.length <= maxChars) return { buffer: next, dropped: 0 };

  const overflow = next.length - maxChars;
  return { buffer: next.slice(overflow), dropped: overflow };
}

function makeSandboxAdapter(
  sandbox: VercelSandbox,
  timeoutMs: number
): BashToolSandbox {
  return {
    async executeCommand(command: string) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await sandbox.runCommand("bash", ["-lc", wrapSandboxCommand(command)], {
          signal: controller.signal,
        });
        const [stdout, stderr] = await Promise.all([
          result.stdout({ signal: controller.signal }),
          result.stderr({ signal: controller.signal }),
        ]);
        return {
          stdout,
          stderr,
          exitCode: result.exitCode,
        };
      } catch (err) {
        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || /aborted/i.test(err.message));
        if (isAbort) {
          return {
            stdout: "",
            stderr: `Command timed out after ${timeoutMs}ms.`,
            exitCode: 124,
          };
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    async readFile(filePath: string) {
      const stream = await sandbox.readFile({ path: filePath });
      if (stream == null) throw new Error(`File not found: ${filePath}`);
      return await readStreamToString(stream);
    },
    async writeFiles(files: Array<{ path: string; content: string | Buffer }>) {
      await sandbox.writeFiles(
        files.map((f) => ({
          path: f.path,
          content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content),
        }))
      );
    },
  };
}

async function runDockerBashCommand(input: {
  client: ReturnType<typeof createDockerSandboxClient>;
  sandboxId: string;
  script: string;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { commandId } = await input.client.startCommand(input.sandboxId, {
    cmd: "bash",
    args: ["-lc", input.script],
    timeoutMs: input.timeoutMs,
    detached: true,
  });

  let stdout = "";
  let stderr = "";
  for await (const log of input.client.streamLogs(input.sandboxId, commandId)) {
    if (log.stream === "stdout") stdout += log.data;
    else stderr += log.data;
  }
  const { exitCode } = await input.client.waitCommand(input.sandboxId, commandId);
  return { stdout, stderr, exitCode };
}

function makeDockerSandboxAdapter(input: {
  client: ReturnType<typeof createDockerSandboxClient>;
  sandboxId: string;
  timeoutMs: number;
}): BashToolSandbox {
  return {
    async executeCommand(command: string) {
      const res = await runDockerBashCommand({
        client: input.client,
        sandboxId: input.sandboxId,
        script: wrapSandboxCommand(command),
        timeoutMs: input.timeoutMs,
      });
      return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
    },
    async readFile(filePath: string) {
      const result = await input.client.readFile(input.sandboxId, filePath);
      if (!result.found) throw new Error(`File not found: ${filePath}`);
      return Buffer.from(result.contentBase64 ?? "", "base64").toString("utf8");
    },
    async writeFiles(files: Array<{ path: string; content: string | Buffer }>) {
      await input.client.writeFiles(
        input.sandboxId,
        files.map((f) => ({
          path: f.path,
          contentBase64: Buffer.isBuffer(f.content)
            ? f.content.toString("base64")
            : Buffer.from(f.content).toString("base64"),
        }))
      );
    },
  };
}

async function ensureSandboxDirectory(
  sandbox: VercelSandbox,
  absolutePath: string
) {
  await sandbox.runCommand("bash", ["-lc", `mkdir -p "${absolutePath}"`]);
}

async function seedSandboxFromUpload(
  sandbox: VercelSandbox,
  cfg: NonNullable<RemcoChatConfig["bashTools"]>
) {
  const root = cfg.projectRoot;
  if (!root) throw new Error("bash_tools.project_root is required for upload seed.");

  let stat: { isDirectory(): boolean };
  try {
    stat = await fs.stat(root);
  } catch (err) {
    throw new Error(
      `bash_tools.project_root does not exist: ${root} (${err instanceof Error ? err.message : "unknown error"})`
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(`bash_tools.project_root is not a directory: ${root}`);
  }

  const destinationRoot = "/vercel/sandbox/workspace";
  await ensureSandboxDirectory(sandbox, destinationRoot);

  const ignoredDirNames = new Set([
    ".git",
    "node_modules",
    ".next",
    "data",
    "test-results",
  ]);

  const shouldIgnoreFile = (relativePosix: string) => {
    const base = path.posix.basename(relativePosix);
    if (base.startsWith(".env") && base !== ".env.example") return true;
    if (base.endsWith(".pem") || base.endsWith(".key")) return true;
    if (relativePosix.startsWith("secrets/")) return true;
    return false;
  };

  const include = cfg.seed.uploadInclude || "**/*";
  const matchesInclude = (relativePosix: string) => {
    if (include === "**/*") return true;
    const extMatch = include.match(/^\*\*\/\*\.\{(.+)\}$/);
    if (extMatch?.[1]) {
      const exts = extMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith(".") ? s : `.${s}`));
      return exts.some((ext) => relativePosix.toLowerCase().endsWith(ext.toLowerCase()));
    }
    const singleExt = include.match(/^\*\*\/\*\.([A-Za-z0-9]+)$/);
    if (singleExt?.[1]) {
      return relativePosix.toLowerCase().endsWith(`.${singleExt[1].toLowerCase()}`);
    }
    return true;
  };

  const maxFiles = 2000;
  let uploaded = 0;
  const batch: Array<{ path: string; content: Buffer }> = [];
  const batchSize = 25;

  const walk = async (absoluteDir: string, relativePrefixPosix: string) => {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirNames.has(entry.name)) continue;
      const nextAbsolute = path.join(absoluteDir, entry.name);
      const nextRelativePosix = relativePrefixPosix
        ? path.posix.join(relativePrefixPosix, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        await walk(nextAbsolute, nextRelativePosix);
        continue;
      }
      if (!entry.isFile()) continue;

      if (!matchesInclude(nextRelativePosix)) continue;
      if (shouldIgnoreFile(nextRelativePosix)) continue;

      const content = await fs.readFile(nextAbsolute);
      batch.push({
        path: path.posix.join(destinationRoot, nextRelativePosix),
        content,
      });

      uploaded += 1;
      if (uploaded > maxFiles) {
        throw new Error(
          `Too many files to upload from project_root (>${maxFiles}). Reduce app.bash_tools.seed.upload_include or use git seeding.`
        );
      }

      if (batch.length >= batchSize) {
        await sandbox.writeFiles(batch);
        batch.length = 0;
      }
    }
  };

  await walk(root, "");
  if (batch.length > 0) {
    await sandbox.writeFiles(batch);
  }
}

async function seedDockerSandboxFromUpload(
  input: {
    client: ReturnType<typeof createDockerSandboxClient>;
    sandboxId: string;
  },
  cfg: NonNullable<RemcoChatConfig["bashTools"]>
) {
  const root = cfg.projectRoot;
  if (!root) throw new Error("bash_tools.project_root is required for upload seed.");

  let stat: { isDirectory(): boolean };
  try {
    stat = await fs.stat(root);
  } catch (err) {
    throw new Error(
      `bash_tools.project_root does not exist: ${root} (${err instanceof Error ? err.message : "unknown error"})`
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(`bash_tools.project_root is not a directory: ${root}`);
  }

  const destinationRoot = "/vercel/sandbox/workspace";

  const ignoredDirNames = new Set([
    ".git",
    "node_modules",
    ".next",
    "data",
    "test-results",
  ]);

  const shouldIgnoreFile = (relativePosix: string) => {
    const base = path.posix.basename(relativePosix);
    if (base.startsWith(".env") && base !== ".env.example") return true;
    if (base.endsWith(".pem") || base.endsWith(".key")) return true;
    if (relativePosix.startsWith("secrets/")) return true;
    return false;
  };

  const include = cfg.seed.uploadInclude || "**/*";
  const matchesInclude = (relativePosix: string) => {
    if (include === "**/*") return true;
    const extMatch = include.match(/^\*\*\/\*\.\{(.+)\}$/);
    if (extMatch?.[1]) {
      const exts = extMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith(".") ? s : `.${s}`));
      return exts.some((ext) => relativePosix.toLowerCase().endsWith(ext.toLowerCase()));
    }
    const singleExt = include.match(/^\*\*\/\*\.([A-Za-z0-9]+)$/);
    if (singleExt?.[1]) {
      return relativePosix.toLowerCase().endsWith(`.${singleExt[1].toLowerCase()}`);
    }
    return true;
  };

  const maxFiles = 2000;
  let uploaded = 0;
  const batch: Array<{ path: string; contentBase64: string }> = [];
  const batchSize = 25;

  const flush = async () => {
    if (batch.length === 0) return;
    await input.client.writeFiles(input.sandboxId, batch.slice());
    batch.length = 0;
  };

  const walk = async (absoluteDir: string, relativePrefixPosix: string) => {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirNames.has(entry.name)) continue;
      const nextAbsolute = path.join(absoluteDir, entry.name);
      const nextRelativePosix = relativePrefixPosix
        ? path.posix.join(relativePrefixPosix, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        await walk(nextAbsolute, nextRelativePosix);
        continue;
      }
      if (!entry.isFile()) continue;

      if (!matchesInclude(nextRelativePosix)) continue;
      if (shouldIgnoreFile(nextRelativePosix)) continue;

      const content = await fs.readFile(nextAbsolute);
      batch.push({
        path: path.posix.join(destinationRoot, nextRelativePosix),
        contentBase64: content.toString("base64"),
      });

      uploaded += 1;
      if (uploaded > maxFiles) {
        throw new Error(
          `Too many files to upload from project_root (>${maxFiles}). Reduce app.bash_tools.seed.upload_include or use git seeding.`
        );
      }

      if (batch.length >= batchSize) await flush();
    }
  };

  await walk(root, "");
  await flush();
}

async function seedDockerSandboxFromGit(
  input: { client: ReturnType<typeof createDockerSandboxClient>; sandboxId: string },
  cfg: NonNullable<RemcoChatConfig["bashTools"]>
) {
  if (!cfg.seed.gitUrl) throw new Error("bash_tools.seed.git_url is required for git seed.");

  const marker = "/vercel/sandbox/workspace/.remcochat/seeded_git";
  const revision = cfg.seed.gitRevision ? String(cfg.seed.gitRevision) : "";
  const script = [
    `set -e`,
    `cd "/vercel/sandbox/workspace"`,
    `mkdir -p ".remcochat"`,
    `if [ -f "${marker}" ]; then exit 0; fi`,
    `existing="$(ls -A | grep -v '^\\.remcochat$' || true)"`,
    `if [ -n "$existing" ]; then`,
    `  touch "${marker}"`,
    `  exit 0`,
    `fi`,
    `git clone "${cfg.seed.gitUrl}" .`,
    ...(revision
      ? [
          `git checkout "${revision}"`,
        ]
      : []),
    `touch "${marker}"`,
  ].join("\n");

  const res = await runDockerBashCommand({
    client: input.client,
    sandboxId: input.sandboxId,
    script,
    timeoutMs: cfg.sandbox.timeoutMs,
  });
  if (res.exitCode !== 0) {
    throw new Error(
      `Failed to seed sandbox from git (exit ${res.exitCode}). stderr:\n${String(res.stderr ?? "").trim()}`
    );
  }
}

async function createSandboxEntry(
  key: string,
  cfg: NonNullable<RemcoChatConfig["bashTools"]>
): Promise<SandboxEntry> {
  const vercel = cfg.provider === "vercel" ? await loadVercelSandbox() : null;

  if (cfg.provider === "docker") {
    if (!cfg.docker) throw new Error("bash_tools.docker config is required.");
    const client = createDockerSandboxClient({
      orchestratorUrl: cfg.docker.orchestratorUrl,
      adminTokenEnv: cfg.docker.adminTokenEnv,
    });

    const { sandboxId, created } = await client.createOrReconnectSandbox({
      sessionKey: key,
      runtime: cfg.sandbox.runtime,
      idleTtlMs: cfg.idleTtlMs,
      resources: { vcpus: cfg.sandbox.vcpus, memoryMb: cfg.docker.memoryMb },
      network: { mode: cfg.docker.networkMode },
      ports: cfg.sandbox.ports,
    });

    if (created) {
      if (cfg.seed.mode === "git") {
        await seedDockerSandboxFromGit({ client, sandboxId }, cfg);
      } else {
        await seedDockerSandboxFromUpload({ client, sandboxId }, cfg);
      }
    }

    return {
      provider: "docker",
      key,
      sandboxId,
      dockerClient: client,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      idleTimer: null,
    };
  }

  const { Sandbox } = vercel!;
  const { runtime, ports, vcpus, timeoutMs } = cfg.sandbox;
  const credentials = sandboxCredentialsFromEnv();
  const sandbox: VercelSandbox =
    cfg.seed.mode === "git"
      ? await Sandbox.create({
          ...(credentials ?? {}),
          source: {
            type: "git",
            url: cfg.seed.gitUrl!,
            ...(cfg.seed.gitRevision ? { revision: cfg.seed.gitRevision } : {}),
          },
          ...(ports.length > 0 ? { ports } : {}),
          runtime,
          resources: { vcpus },
          timeout: timeoutMs,
        })
      : await Sandbox.create({
          ...(credentials ?? {}),
          ...(ports.length > 0 ? { ports } : {}),
          runtime,
          resources: { vcpus },
          timeout: timeoutMs,
        });

  if (cfg.seed.mode === "upload") {
    await seedSandboxFromUpload(sandbox, cfg);
  }

  return {
    provider: "vercel",
    key,
    sandbox,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    idleTimer: null,
  };
}

async function stopSandboxEntry(entry: SandboxEntry) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  try {
    if (entry.provider === "vercel") {
      await entry.sandbox!.stop();
    } else {
      await entry.dockerClient!.stopSandbox(entry.sandboxId!);
    }
  } catch {
    // ignore
  }
}

async function evictIfNeeded(cfg: NonNullable<RemcoChatConfig["bashTools"]>) {
  const max = cfg.maxConcurrentSandboxes;
  while (sandboxesByKey.size >= max) {
    const entries = Array.from(sandboxesByKey.values());
    entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const oldest = entries[0];
    if (!oldest) return;
    sandboxesByKey.delete(oldest.key);
    await stopSandboxEntry(oldest);
  }
}

function touchSandbox(entry: SandboxEntry, cfg: NonNullable<RemcoChatConfig["bashTools"]>) {
  entry.lastUsedAt = Date.now();
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    sandboxesByKey.delete(entry.key);
    stopSandboxEntry(entry).catch(() => {});
  }, cfg.idleTtlMs);
}

async function getOrCreateSandboxEntry(
  key: string,
  cfg: NonNullable<RemcoChatConfig["bashTools"]>
): Promise<SandboxEntry> {
  const existing = sandboxesByKey.get(key);
  if (existing) {
    touchSandbox(existing, cfg);
    return existing;
  }

  const existingLock = createLocks.get(key);
  if (existingLock) return await existingLock;

  const lock = (async () => {
    await evictIfNeeded(cfg);
    const entry = await createSandboxEntry(key, cfg);
    sandboxesByKey.set(key, entry);
    touchSandbox(entry, cfg);
    return entry;
  })();

  createLocks.set(key, lock);
  try {
    return await lock;
  } finally {
    createLocks.delete(key);
  }
}

function prewarmSandboxEntry(key: string, cfg: NonNullable<RemcoChatConfig["bashTools"]>) {
  if (sandboxesByKey.has(key)) return;
  if (createLocks.has(key)) return;
  void getOrCreateSandboxEntry(key, cfg).catch((err) => {
    console.error(`[bash-tools] Failed to prewarm sandbox for session ${key}:`, err);
  });
}

function makeLazySandboxAdapter(input: {
  sessionKey: string;
  cfg: NonNullable<RemcoChatConfig["bashTools"]>;
}): BashToolSandbox {
  const { sessionKey, cfg } = input;
  const resolveAdapter = async (): Promise<BashToolSandbox> => {
    const entry = await getOrCreateSandboxEntry(sessionKey, cfg);
    if (entry.provider === "docker") {
      return makeDockerSandboxAdapter({
        client: entry.dockerClient!,
        sandboxId: entry.sandboxId!,
        timeoutMs: cfg.timeoutMs,
      });
    }
    return makeSandboxAdapter(entry.sandbox!, cfg.timeoutMs);
  };

  return {
    async executeCommand(command: string) {
      const adapter = await resolveAdapter();
      return adapter.executeCommand(command);
    },
    async readFile(filePath: string) {
      const adapter = await resolveAdapter();
      return adapter.readFile(filePath);
    },
    async writeFiles(files: Array<{ path: string; content: string | Buffer }>) {
      const adapter = await resolveAdapter();
      return adapter.writeFiles(files);
    },
  };
}

function createStreamingBashTool(input: {
  sessionKey: string;
  cfg: NonNullable<RemcoChatConfig["bashTools"]>;
  destination: string;
  description: string;
}) {
  const { sessionKey, cfg, destination, description } = input;
  return createTool({
    description,
    inputSchema: z.object({
      command: z.string().describe("The bash command to execute"),
    }),
    execute: async function* (
      { command: originalCommand },
      options
    ): AsyncGenerator<{
      stdout: string;
      stderr: string;
      exitCode: number;
      stdoutTruncatedChars?: number;
      stderrTruncatedChars?: number;
    }> {
      const emitIntervalMs = 150;
      const emitMinDeltaChars = 512;
      let lastEmitAt = 0;
      let lastEmitLen = 0;

      const command = String(originalCommand ?? "");
      const fullCommand = `cd "${destination}" && ${command}`;

      const abortSignal = options.abortSignal;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      const onAbort = () => controller.abort();
      abortSignal?.addEventListener("abort", onAbort, { once: true });

      let stdoutTail = "";
      let stderrTail = "";
      let stdoutDropped = 0;
      let stderrDropped = 0;

      const makeOutput = (exitCode: number) => {
        return {
          stdout: stdoutTail,
          stderr: stderrTail,
          exitCode,
          ...(stdoutDropped > 0 ? { stdoutTruncatedChars: stdoutDropped } : {}),
          ...(stderrDropped > 0 ? { stderrTruncatedChars: stderrDropped } : {}),
        };
      };

      const appendLog = (log: { stream: "stdout" | "stderr"; data: string }) => {
        if (log.stream === "stdout") {
          const appended = appendTailBuffer(stdoutTail, log.data, cfg.maxStdoutChars);
          stdoutTail = appended.buffer;
          stdoutDropped += appended.dropped;
        } else {
          const appended = appendTailBuffer(stderrTail, log.data, cfg.maxStderrChars);
          stderrTail = appended.buffer;
          stderrDropped += appended.dropped;
        }

        const now = Date.now();
        const len = stdoutTail.length + stderrTail.length;
        const changedEnough = Math.abs(len - lastEmitLen) >= emitMinDeltaChars;
        const timeOk = now - lastEmitAt >= emitIntervalMs;
        if (timeOk || changedEnough) {
          lastEmitAt = now;
          lastEmitLen = len;
          return true;
        }
        return false;
      };

      try {
        const entry = await getOrCreateSandboxEntry(sessionKey, cfg);
        if (entry.provider === "docker") {
          const client = entry.dockerClient!;
          const sandboxId = entry.sandboxId!;
          let commandId: string | null = null;

          try {
            const started = await client.startCommand(sandboxId, {
              cmd: "bash",
              args: ["-lc", wrapSandboxCommand(fullCommand)],
              timeoutMs: cfg.timeoutMs,
              detached: true,
            });
            commandId = started.commandId;
            yield makeOutput(-1);

            for await (const log of client.streamLogs(sandboxId, commandId, {
              abortSignal: controller.signal,
            })) {
              if (appendLog(log)) yield makeOutput(-1);
            }

            const finished = await client.waitCommand(sandboxId, commandId);
            yield makeOutput(finished.exitCode);
          } catch (err) {
            const isAbort =
              err instanceof Error &&
              (err.name === "AbortError" || /aborted/i.test(err.message));

            if (commandId) {
              try {
                await client.killCommand(sandboxId, commandId);
              } catch {
                // ignore
              }
            }

            if (isAbort) {
              stderrTail = `Command timed out after ${cfg.timeoutMs}ms.`;
              yield makeOutput(124);
              return;
            }

            throw err;
          }

          return;
        }

        const sandbox = entry.sandbox!;
        let runningCmd: VercelCommand | null = null;
        try {
          runningCmd = await sandbox.runCommand({
            cmd: "bash",
            args: ["-lc", wrapSandboxCommand(fullCommand)],
            detached: true,
            signal: controller.signal,
          });

          yield makeOutput(-1);

          const logs = runningCmd.logs({ signal: controller.signal });
          try {
            for await (const log of logs) {
              if (appendLog(log)) yield makeOutput(-1);
            }
          } finally {
            logs.close();
          }

          const finished = await runningCmd.wait({ signal: controller.signal });
          yield makeOutput(finished.exitCode);
        } catch (err) {
          const isAbort =
            err instanceof Error &&
            (err.name === "AbortError" || /aborted/i.test(err.message));

          if (runningCmd) {
            try {
              await runningCmd.kill("SIGTERM");
            } catch {
              // ignore
            }
          }

          if (isAbort) {
            stderrTail = `Command timed out after ${cfg.timeoutMs}ms.`;
            yield makeOutput(124);
            return;
          }

          throw err;
        }
      } finally {
        clearTimeout(timer);
        abortSignal?.removeEventListener("abort", onAbort);
      }
    },
  });
}

function createSandboxUrlTool(input: {
  sessionKey: string;
  cfg: NonNullable<RemcoChatConfig["bashTools"]>;
}) {
  const { sessionKey, cfg } = input;
  return createTool({
    description:
      cfg.provider === "docker"
        ? "Get a URL for a port exposed from the current sandbox."
        : "Get a publicly accessible URL for a port exposed from the current Vercel Sandbox.",
    inputSchema: z.object({
      port: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .describe("Port number that the sandbox service is listening on.")
        .default(3000),
    }),
    execute: async ({ port }) => {
      const entry = await getOrCreateSandboxEntry(sessionKey, cfg);
      if (entry.provider === "docker") {
        const resolved = await entry.dockerClient!.getPortUrl(entry.sandboxId!, port);
        if (!resolved.found || !resolved.url) {
          throw new Error(
            `Port ${port} is not published for this sandbox. Set app.bash_tools.sandbox.ports = [${port}] and recreate the sandbox.`
          );
        }
        return { url: resolved.url };
      }

      const ports = cfg.sandbox.ports;
      if (!Array.isArray(ports) || ports.length === 0) {
        throw new Error(
          "No public sandbox ports are configured. Set app.bash_tools.sandbox.ports = [3000] (max 4) to enable preview URLs."
        );
      }
      if (!ports.includes(port)) {
        throw new Error(
          `Port ${port} is not exposed for this sandbox. Use one of: ${ports.join(", ")} (or update app.bash_tools.sandbox.ports).`
        );
      }
      try {
        return { url: entry.sandbox!.domain(port) };
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to resolve sandbox URL."
        );
      }
    },
  });
}

export async function createBashTools(input: {
  request: Request;
  sessionKey: string;
}): Promise<BashToolsResult> {
  const cfg = getConfig().bashTools;
  if (!cfg || !cfg.enabled) return { enabled: false, tools: {} };
  if (!bashToolsKillSwitchEnabled()) return { enabled: false, tools: {} };
  if (!isRequestAllowedByAccessPolicy(input.request, cfg)) {
    return { enabled: false, tools: {} };
  }

  try {
    prewarmSandboxEntry(input.sessionKey, cfg);
    const { createBashTool } = await loadBashTool();

    const destination = "/vercel/sandbox/workspace";
    const maxOutputLength = Math.max(cfg.maxStdoutChars, cfg.maxStderrChars);
    const adapter = makeLazySandboxAdapter({ sessionKey: input.sessionKey, cfg });

    const { tools } = await createBashTool({
      sandbox: adapter,
      destination,
      maxOutputLength,
      onAfterBashCall: ({ result }) => {
        return {
          result: {
            ...result,
            stdout: truncateWithNotice(
              String(result.stdout ?? "").trimEnd(),
              cfg.maxStdoutChars,
              "stdout"
            ),
            stderr: truncateWithNotice(
              String(result.stderr ?? "").trimEnd(),
              cfg.maxStderrChars,
              "stderr"
            ),
          },
        };
      },
    });

    const streamingBash = createStreamingBashTool({
      sessionKey: input.sessionKey,
      cfg,
      destination,
      description:
        typeof tools.bash?.description === "string"
          ? tools.bash.description
          : "Execute bash commands in the sandbox environment.",
    });
    const sandboxUrl = createSandboxUrlTool({ sessionKey: input.sessionKey, cfg });

    return { enabled: true, tools: { ...tools, bash: streamingBash, sandboxUrl } };
  } catch (err) {
    console.error(
      `[bash-tools] Failed to initialize bash tools for session ${input.sessionKey}:`,
      err
    );
    return { enabled: false, tools: {} };
  }
}

export async function runExplicitBashCommand(input: {
  request: Request;
  sessionKey: string;
  command: string;
}): Promise<ExplicitBashCommandResult> {
  const cfg = getConfig().bashTools;
  if (!cfg || !cfg.enabled) {
    return { enabled: false, stdout: "", stderr: "Bash tools are disabled.", exitCode: 1 };
  }
  if (!bashToolsKillSwitchEnabled()) {
    return { enabled: false, stdout: "", stderr: "Bash tools are disabled.", exitCode: 1 };
  }
  if (!isRequestAllowedByAccessPolicy(input.request, cfg)) {
    return { enabled: false, stdout: "", stderr: "Bash tools are not enabled for this request.", exitCode: 1 };
  }

  const entry = await getOrCreateSandboxEntry(input.sessionKey, cfg);
  const destination = "/vercel/sandbox/workspace";
  const command = String(input.command ?? "");
  const fullCommand = `cd "${destination}" && ${command}`;

  if (entry.provider === "docker") {
    const res = await runDockerBashCommand({
      client: entry.dockerClient!,
      sandboxId: entry.sandboxId!,
      script: wrapSandboxCommand(fullCommand),
      timeoutMs: cfg.timeoutMs,
    });
    return {
      enabled: true,
      stdout: truncateWithNotice(
        String(res.stdout ?? "").trimEnd(),
        cfg.maxStdoutChars,
        "stdout"
      ),
      stderr: truncateWithNotice(
        String(res.stderr ?? "").trimEnd(),
        cfg.maxStderrChars,
        "stderr"
      ),
      exitCode: res.exitCode,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const result = await entry.sandbox!.runCommand(
      "bash",
      ["-lc", wrapSandboxCommand(fullCommand)],
      { signal: controller.signal }
    );
    const [stdoutStream, stderrStream] = await Promise.all([
      result.stdout({ signal: controller.signal }),
      result.stderr({ signal: controller.signal }),
    ]);
    const [stdout, stderr] = await Promise.all([
      readStreamToString(stdoutStream),
      readStreamToString(stderrStream),
    ]);

    return {
      enabled: true,
      stdout: truncateWithNotice(
        String(stdout ?? "").trimEnd(),
        cfg.maxStdoutChars,
        "stdout"
      ),
      stderr: truncateWithNotice(
        String(stderr ?? "").trimEnd(),
        cfg.maxStderrChars,
        "stderr"
      ),
      exitCode: result.exitCode,
    };
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
    if (isAbort) {
      return {
        enabled: true,
        stdout: "",
        stderr: `Command timed out after ${cfg.timeoutMs}ms.`,
        exitCode: 124,
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
