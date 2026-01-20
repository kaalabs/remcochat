import type { Sandbox as VercelSandbox } from "@vercel/sandbox";
import { getConfig, type RemcoChatConfig } from "@/server/config";

let cachedVercelSandboxModule:
  | Promise<{
      Sandbox: typeof import("@vercel/sandbox")["Sandbox"];
    }>
  | null = null;

async function loadVercelSandbox() {
  if (!cachedVercelSandboxModule) {
    cachedVercelSandboxModule = import("@vercel/sandbox") as Promise<{
      Sandbox: typeof import("@vercel/sandbox")["Sandbox"];
    }>;
  }
  return await cachedVercelSandboxModule;
}

type ProcessingSandboxEntry = {
  sandbox: VercelSandbox;
  createdAt: number;
  lastUsedAt: number;
  idleTimer: NodeJS.Timeout | null;
  initialized: boolean;
  pdfDepsInstalled: boolean;
};

let processingSandbox: ProcessingSandboxEntry | null = null;
let processingSandboxLock: Promise<ProcessingSandboxEntry> | null = null;
let processingQueue: Promise<unknown> = Promise.resolve();

const WORKDIR = "/vercel/sandbox/workspace/.remcochat-attachments";
const INPUT_DIR = `${WORKDIR}/inputs`;
const EXTRACT_SCRIPT = `${WORKDIR}/extract.mjs`;
const PACKAGE_JSON = `${WORKDIR}/package.json`;

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

function formatSandboxCommandIO(res: { stdout: string; stderr: string }) {
  const stderr = String(res.stderr ?? "").trim();
  const stdout = String(res.stdout ?? "").trim();
  if (!stderr && !stdout) return "(empty)";
  if (stderr && stdout) return `stderr:\n${stderr}\n\nstdout:\n${stdout}`;
  if (stderr) return `stderr:\n${stderr}`;
  return `stdout:\n${stdout}`;
}

async function stopProcessingSandbox(entry: ProcessingSandboxEntry) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  try {
    await entry.sandbox.stop();
  } catch {
    // ignore
  }
}

function touchProcessingSandbox(entry: ProcessingSandboxEntry, cfg: RemcoChatConfig["attachments"]) {
  entry.lastUsedAt = Date.now();
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  const idleTtlMs = Math.min(cfg.sandbox.timeoutMs, 15 * 60_000);
  entry.idleTimer = setTimeout(() => {
    processingSandbox = null;
    stopProcessingSandbox(entry).catch(() => {});
  }, idleTtlMs);
}

async function createProcessingSandbox(cfg: RemcoChatConfig["attachments"]): Promise<ProcessingSandboxEntry> {
  const { Sandbox } = await loadVercelSandbox();
  const credentials = sandboxCredentialsFromEnv();
  const sandbox: VercelSandbox = await Sandbox.create({
    ...(credentials ?? {}),
    runtime: cfg.sandbox.runtime,
    resources: { vcpus: cfg.sandbox.vcpus },
    timeout: cfg.sandbox.timeoutMs,
  });

  const entry: ProcessingSandboxEntry = {
    sandbox,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    idleTimer: null,
    initialized: false,
    pdfDepsInstalled: false,
  };
  touchProcessingSandbox(entry, cfg);
  return entry;
}

async function getOrCreateProcessingSandbox(): Promise<ProcessingSandboxEntry> {
  const cfg = getConfig().attachments;
  if (!cfg.enabled) throw new Error("Attachments are disabled.");

  if (processingSandbox) {
    touchProcessingSandbox(processingSandbox, cfg);
    return processingSandbox;
  }

  if (processingSandboxLock) return await processingSandboxLock;

  processingSandboxLock = (async () => {
    const created = await createProcessingSandbox(cfg);
    processingSandbox = created;
    return created;
  })();

  try {
    return await processingSandboxLock;
  } finally {
    processingSandboxLock = null;
  }
}

async function runSandboxCommand(
  sandbox: VercelSandbox,
  cfg: RemcoChatConfig["attachments"],
  command: { cmd: string; args: string[] },
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await sandbox.runCommand(command.cmd, command.args, {
      signal: controller.signal,
    });
    const [stdout, stderr] = await Promise.all([
      result.stdout({ signal: controller.signal }),
      result.stderr({ signal: controller.signal }),
    ]);
    return {
      stdout: truncateWithNotice(stdout, cfg.processing.maxStdoutChars, "stdout"),
      stderr: truncateWithNotice(stderr, cfg.processing.maxStderrChars, "stderr"),
      exitCode: result.exitCode,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureExtractorFiles(entry: ProcessingSandboxEntry) {
  if (entry.initialized) return;

  const cfg = getConfig().attachments;
  const script = [
    `import fs from "node:fs/promises";`,
    `import path from "node:path";`,
    `import process from "node:process";`,
    ``,
    `async function safeWriteResult(outPath, obj) {`,
    `  try {`,
    `    const payload = JSON.stringify(obj);`,
    `    await fs.mkdir(path.dirname(outPath), { recursive: true });`,
    `    await fs.writeFile(outPath, payload, "utf8");`,
    `  } catch (err) {`,
    `    const message = err instanceof Error ? err.message : String(err);`,
    `    try {`,
    `      process.stderr.write("Failed to write extraction result: " + message + "\\n");`,
    `    } catch {`,
    `      // ignore`,
    `    }`,
    `    process.exit(1);`,
    `  }`,
    `}`,
    ``,
    `const filePath = String(process.argv[2] ?? "").trim();`,
    `const mediaType = String(process.argv[3] ?? "").trim();`,
    `const maxCharsRaw = String(process.argv[4] ?? "").trim();`,
    `const outPath = String(process.argv[5] ?? "").trim();`,
    `const maxChars = Math.max(200, Math.min(2_000_000, Number(maxCharsRaw || 120000) || 120000));`,
    ``,
    `if (!filePath || !mediaType || !outPath) {`,
    `  await safeWriteResult(outPath || "/tmp/remcochat-attachments-result.json", { ok: false, error: "Missing input." });`,
    `  process.exit(0);`,
    `}`,
    ``,
    `let bytes;`,
    `try {`,
    `  bytes = await fs.readFile(filePath);`,
    `} catch {`,
    `  await safeWriteResult(outPath, { ok: false, error: "Failed to read file." });`,
    `  process.exit(0);`,
    `}`,
    ``,
    `try {`,
    `  if (mediaType === "application/pdf") {`,
    `    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");`,
    `    const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);`,
    `    const loadingTask = pdfjs.getDocument({ data, disableWorker: true });`,
    `    const pdf = await loadingTask.promise;`,
    `    let text = "";`,
    `    for (let i = 1; i <= pdf.numPages; i += 1) {`,
    `      const page = await pdf.getPage(i);`,
    `      const content = await page.getTextContent();`,
    `      const pageText = (content.items || []).map((it) => (it && typeof it.str === "string" ? it.str : "")).join(" ");`,
    `      text += pageText + "\\n";`,
    `      if (text.length > maxChars) break;`,
    `    }`,
    `    const truncated = text.length > maxChars;`,
    `    if (truncated) text = text.slice(0, maxChars);`,
    `    await safeWriteResult(outPath, { ok: true, text, truncated });`,
    `    process.exit(0);`,
    `  }`,
    ``,
    `  const decoded = bytes.toString("utf8");`,
    `  const truncated = decoded.length > maxChars;`,
    `  const text = truncated ? decoded.slice(0, maxChars) : decoded;`,
    `  await safeWriteResult(outPath, { ok: true, text, truncated });`,
    `} catch (err) {`,
    `  await safeWriteResult(outPath, { ok: false, error: err instanceof Error ? err.message : "Extraction failed." });`,
    `}`,
    ``,
  ].join("\n");

  const pkg = JSON.stringify(
    {
      name: "remcochat-attachment-processing",
      private: true,
      type: "module",
    },
    null,
    2
  );

  await entry.sandbox.runCommand("bash", ["-lc", `mkdir -p "${INPUT_DIR}"`]);
  await entry.sandbox.writeFiles([
    { path: EXTRACT_SCRIPT, content: Buffer.from(script, "utf8") },
    { path: PACKAGE_JSON, content: Buffer.from(pkg, "utf8") },
  ]);

  entry.initialized = true;
  touchProcessingSandbox(entry, cfg);
}

async function ensurePdfDepsInstalled(entry: ProcessingSandboxEntry) {
  if (entry.pdfDepsInstalled) return;
  const cfg = getConfig().attachments;

  // Fast path: dependency already present.
  {
    const res = await runSandboxCommand(
      entry.sandbox,
      cfg,
      { cmd: "bash", args: ["-lc", `test -f "${WORKDIR}/node_modules/pdfjs-dist/package.json"`] },
      Math.min(cfg.processing.timeoutMs, 10_000)
    );
    if (res.exitCode === 0) {
      entry.pdfDepsInstalled = true;
      return;
    }
  }

  const installTimeout = Math.min(cfg.sandbox.timeoutMs, 5 * 60_000);
  const res = await runSandboxCommand(
    entry.sandbox,
    cfg,
    {
      cmd: "bash",
      args: ["-lc", `cd "${WORKDIR}" && npm install --silent --no-progress pdfjs-dist@4`],
    },
    installTimeout
  );
  if (res.exitCode !== 0) {
    throw new Error(
      `Failed to install PDF extractor dependencies in sandbox. stderr:\n${res.stderr || "(empty)"}`
    );
  }

  entry.pdfDepsInstalled = true;
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = processingQueue.then(work, work);
  processingQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export type SandboxExtractResult = {
  text: string;
  truncated: boolean;
};

export async function extractTextInSandbox(input: {
  attachmentId: string;
  mediaType: string;
  bytes: Buffer;
}): Promise<SandboxExtractResult> {
  const cfg = getConfig().attachments;
  if (!cfg.enabled) throw new Error("Attachments are disabled.");

  return await enqueue(async () => {
    const entry = await getOrCreateProcessingSandbox();
    touchProcessingSandbox(entry, cfg);

    await ensureExtractorFiles(entry);
    if (input.mediaType === "application/pdf") {
      await ensurePdfDepsInstalled(entry);
    }

    const id = String(input.attachmentId ?? "").trim();
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error("Invalid attachment id.");
    }

    const filePath = `${INPUT_DIR}/${id}`;
    const outPath = `${INPUT_DIR}/${id}.result.json`;
    await entry.sandbox.writeFiles([{ path: filePath, content: input.bytes }]);
    try {
      await entry.sandbox.runCommand("rm", ["-f", outPath]);
    } catch {
      // ignore
    }

    const maxChars = Math.max(200, cfg.maxExtractedTextChars);

    const timeoutMs = cfg.processing.timeoutMs;
    const res = await runSandboxCommand(
      entry.sandbox,
      cfg,
      {
        cmd: "node",
        args: [EXTRACT_SCRIPT, filePath, input.mediaType, String(maxChars), outPath],
      },
      timeoutMs
    );

    // Best-effort cleanup
    entry.sandbox.runCommand("rm", ["-f", filePath]).catch(() => {});

    if (res.exitCode !== 0) {
      throw new Error(
        `Sandbox extraction failed (exit ${res.exitCode}).\n${formatSandboxCommandIO(res)}`
      );
    }

    const buf = await entry.sandbox.readFileToBuffer({ path: outPath });
    if (!buf) {
      throw new Error(
        `Sandbox extraction produced no output file.\n${formatSandboxCommandIO(res)}`
      );
    }
    const rawText = buf.toString("utf8").trim();
    if (!rawText) {
      throw new Error(
        `Sandbox extraction produced empty output.\n${formatSandboxCommandIO(res)}`
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error(
        `Sandbox extraction returned invalid JSON.\n${formatSandboxCommandIO(res)}`
      );
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("Sandbox extraction returned invalid output.");
    }

    const ok = (payload as { ok?: unknown }).ok === true;
    if (!ok) {
      const errorText = (payload as { error?: unknown }).error;
      throw new Error(
        typeof errorText === "string" && errorText.trim()
          ? errorText
          : "Sandbox extraction failed."
      );
    }

    const textRaw = (payload as { text?: unknown }).text;
    const truncatedRaw = (payload as { truncated?: unknown }).truncated;
    const text = typeof textRaw === "string" ? textRaw : "";
    const truncated = truncatedRaw === true;

    // Best-effort cleanup
    entry.sandbox.runCommand("rm", ["-f", outPath]).catch(() => {});

    return { text, truncated };
  });
}
