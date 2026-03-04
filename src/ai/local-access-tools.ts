import { tool as createTool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/server/config";
import { isRequestAllowedByAdminPolicy } from "@/server/request-auth";
import { requireLocalCommandAllowed, requireLocalPathAllowed } from "@/server/local-access";

const execFileAsync = promisify(execFile);

export type LocalAccessToolsResult = {
  enabled: boolean;
  tools: Record<string, unknown>;
};

function normalizeList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const trimmed = String(v ?? "").trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function readUtf8PrefixWithLimit(input: {
  filePath: string;
  maxBytes: number;
}): Promise<{ text: string; truncated: boolean; removedBytes: number }> {
  const maxBytes = Math.max(1, Math.floor(input.maxBytes));
  return fs
    .stat(input.filePath)
    .then((stat) => {
      if (!stat.isFile()) throw new Error("Not a file.");
      const totalBytes = stat.size;
      const truncated = totalBytes > maxBytes;
      const toRead = truncated ? maxBytes : totalBytes;
      return fs.open(input.filePath, "r").then(async (fh) => {
        try {
          const buffer = Buffer.allocUnsafe(toRead);
          const { bytesRead } = await fh.read(buffer, 0, toRead, 0);
          return {
            text: buffer.subarray(0, bytesRead).toString("utf8"),
            truncated,
            removedBytes: Math.max(0, totalBytes - bytesRead),
          };
        } finally {
          await fh.close().catch(() => {});
        }
      });
    });
}

export function createLocalAccessTools(input: { request: Request }): LocalAccessToolsResult {
  const config = getConfig();
  const policy = config.localAccess;
  if (!policy?.enabled) return { enabled: false, tools: {} };

  // Host execution is high-risk: require admin policy (localhost OR admin token).
  if (!isRequestAllowedByAdminPolicy(input.request)) {
    return { enabled: false, tools: {} };
  }

  const allowedCommands = normalizeList(policy.allowedCommands);
  const allowedDirectories = normalizeList(policy.allowedDirectories);

  if (allowedCommands.length === 0 && allowedDirectories.length === 0) {
    return { enabled: false, tools: {} };
  }

  const tools: Record<string, unknown> = {};

  if (allowedCommands.length > 0) {
    tools.localExec = createTool({
      description:
        "Execute a local (host) command via execFile. Only allowlisted commands are permitted. This does NOT run in the sandbox.",
      inputSchema: z.object({
        cmd: z.string().describe("Command name or absolute path (must be allowlisted)."),
        args: z.array(z.string()).optional().describe("Arguments (no shell)."),
        timeoutMs: z
          .number()
          .int()
          .min(250)
          .max(120_000)
          .optional()
          .describe("Optional timeout override (ms)."),
      }),
      execute: async ({ cmd, args, timeoutMs }) => {
        const command = String(cmd ?? "").trim();
        const argv = Array.isArray(args) ? args : [];
        const safeArgs = argv.slice(0, 64).map((a) => String(a ?? "").slice(0, 8_192));

        requireLocalCommandAllowed({
          cfg: config,
          command,
          feature: "tool.localExec",
        });

        try {
          const res = await execFileAsync(command, safeArgs, {
            timeout: Math.max(250, Math.floor(timeoutMs ?? 20_000)),
            maxBuffer: 10 * 1024 * 1024,
          });
          return {
            stdout: String(res.stdout ?? ""),
            stderr: String(res.stderr ?? ""),
            exitCode: 0,
          };
        } catch (err) {
          const e = err as {
            stdout?: unknown;
            stderr?: unknown;
            code?: unknown;
            signal?: unknown;
            message?: unknown;
          };
          const exitCode =
            typeof e.code === "number"
              ? e.code
              : typeof e.signal === "string"
                ? 128
                : 1;
          return {
            stdout: String(e.stdout ?? ""),
            stderr: String(e.stderr ?? (e.message ?? "Command failed.")),
            exitCode,
          };
        }
      },
    });

    if (allowedCommands.includes("obsidian") || allowedCommands.includes("*")) {
      tools.obsidian = createTool({
        description:
          "Run the Obsidian CLI against a running Obsidian instance on this host. Requires Obsidian to be open. Example: args=['daily:read'].",
        inputSchema: z.object({
          args: z.array(z.string()).describe("Arguments to pass to the `obsidian` CLI."),
          timeoutMs: z
            .number()
            .int()
            .min(250)
            .max(120_000)
            .optional()
            .describe("Optional timeout override (ms)."),
        }),
        execute: async ({ args, timeoutMs }) => {
          requireLocalCommandAllowed({
            cfg: config,
            command: "obsidian",
            feature: "tool.obsidian",
          });
          const safeArgs = (args ?? []).slice(0, 64).map((a) => String(a ?? "").slice(0, 8_192));
          try {
            const res = await execFileAsync("obsidian", safeArgs, {
              timeout: Math.max(250, Math.floor(timeoutMs ?? 20_000)),
              maxBuffer: 10 * 1024 * 1024,
            });
            return {
              stdout: String(res.stdout ?? ""),
              stderr: String(res.stderr ?? ""),
              exitCode: 0,
            };
          } catch (err) {
            const e = err as {
              stdout?: unknown;
              stderr?: unknown;
              code?: unknown;
              signal?: unknown;
              message?: unknown;
            };
            const exitCode =
              typeof e.code === "number"
                ? e.code
                : typeof e.signal === "string"
                  ? 128
                  : 1;
            return {
              stdout: String(e.stdout ?? ""),
              stderr: String(e.stderr ?? (e.message ?? "Obsidian command failed.")),
              exitCode,
            };
          }
        },
      });
    }
  }

  if (allowedDirectories.length > 0) {
    tools.localReadFile = createTool({
      description:
        "Read a UTF-8 text file from the local (host) filesystem. Path must be inside allowlisted directories.",
      inputSchema: z.object({
        path: z.string().describe("Absolute or relative path on the host."),
        maxBytes: z
          .number()
          .int()
          .min(1_000)
          .max(20_000_000)
          .optional()
          .describe("Maximum bytes to read (prefix)."),
      }),
      execute: async ({ path: filePath, maxBytes }) => {
        const p = String(filePath ?? "").trim();
        requireLocalPathAllowed({
          cfg: config,
          localPath: p,
          feature: "tool.localReadFile",
          operation: "read",
        });

        const limit = Math.max(1_000, Math.floor(maxBytes ?? 200_000));
        const read = await readUtf8PrefixWithLimit({ filePath: p, maxBytes: limit });
        const suffix =
          read.truncated && read.removedBytes > 0
            ? `\n\n[LOCAL_FILE_TRUNCATED: ${read.removedBytes} bytes removed]`
            : "";
        return { content: read.text + suffix, truncated: read.truncated };
      },
    });

    tools.localListDir = createTool({
      description:
        "List a local (host) directory. Path must be inside allowlisted directories.",
      inputSchema: z.object({
        path: z.string().describe("Directory path on the host."),
        maxEntries: z.number().int().min(1).max(500).optional(),
      }),
      execute: async ({ path: dirPath, maxEntries }) => {
        const p = String(dirPath ?? "").trim();
        requireLocalPathAllowed({
          cfg: config,
          localPath: p,
          feature: "tool.localListDir",
          operation: "scan",
        });

        const stat = await fs.stat(p);
        if (!stat.isDirectory()) throw new Error("Not a directory.");
        const entries = await fs.readdir(p, { withFileTypes: true });
        const limit = Math.max(1, Math.floor(maxEntries ?? 200));
        return {
          path: path.resolve(p),
          entries: entries.slice(0, limit).map((e) => ({
            name: e.name,
            kind: e.isDirectory() ? "dir" : e.isFile() ? "file" : e.isSymbolicLink() ? "symlink" : "other",
          })),
          truncated: entries.length > limit,
        };
      },
    });
  }

  return { enabled: Object.keys(tools).length > 0, tools };
}

