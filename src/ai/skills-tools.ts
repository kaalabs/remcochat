import { tool as createTool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfig } from "@/server/config";
import { recordActivatedSkillName } from "@/server/chats";
import { logEvent } from "@/server/log";
import { getSkillsRegistry } from "@/server/skills/runtime";
import { parseSkillMd } from "@/server/skills/skill-md";

export type SkillsToolsResult = {
  enabled: boolean;
  tools: Record<string, unknown>;
};

function readUtf8WithSoftByteLimit(input: {
  filePath: string;
  maxBytes: number;
}): { text: string; truncated: boolean; removedBytes: number } {
  const stat = fs.statSync(input.filePath);
  if (!stat.isFile()) throw new Error("Not a file.");

  const maxBytes = Math.max(1, Math.floor(input.maxBytes));
  const totalBytes = stat.size;
  const truncated = totalBytes > maxBytes;
  const toRead = truncated ? maxBytes : totalBytes;

  if (toRead <= 0) return { text: "", truncated, removedBytes: totalBytes };

  const fd = fs.openSync(input.filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(toRead);
    const bytesRead = fs.readSync(fd, buffer, 0, toRead, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    return {
      text,
      truncated,
      removedBytes: Math.max(0, totalBytes - bytesRead),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function appendTruncationNotice(input: {
  text: string;
  removedBytes: number;
  kind: "SKILL.md" | "resource";
}): string {
  if (input.removedBytes <= 0) return input.text;
  return `${input.text}\n\n[REMCOCHAT_SKILLS_TRUNCATED: ${input.kind}; ${input.removedBytes} bytes removed]`;
}

function sanitizeToolErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const trimmed = message.trim();
  if (!trimmed) return "Skills tool error.";

  if (/ENOENT:/.test(trimmed)) return "Resource not found.";
  if (/\b(EACCES|EPERM)\b/.test(trimmed)) return "Access denied.";

  const cwdAbs = path.resolve(process.cwd()).replace(/\/+$/, "");
  const homeAbs = path.resolve(os.homedir()).replace(/\/+$/, "");

  let out = trimmed.replaceAll(cwdAbs, ".").replaceAll(homeAbs, "~");
  out = out.replace(/(^|[\s(])\/[^\s)]+/g, "$1<redacted>");
  out = out.replace(/(^|[\s(])[A-Za-z]:\\\\[^\s)]+/g, "$1<redacted>");

  return out.length > 500 ? `${out.slice(0, 500)}…` : out;
}

function resolveSkillResourcePathOrThrow(input: {
  skillDir: string;
  relativePath: string;
}): { rel: string; fullPath: string } {
  const raw = String(input.relativePath ?? "").trim();
  if (!raw) throw new Error("Missing resource path.");

  const relPosix = raw.replace(/\\/g, "/");
  if (path.posix.isAbsolute(relPosix) || path.win32.isAbsolute(relPosix)) {
    throw new Error("Absolute paths are not allowed.");
  }

  const normalized = path.posix.normalize(relPosix).replace(/^(\.\/)+/, "");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("Invalid resource path.");
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Path traversal is not allowed.");
  }
  if (normalized.includes("/../")) {
    throw new Error("Path traversal is not allowed.");
  }

  const candidate = path.join(input.skillDir, ...normalized.split("/"));

  const skillReal = fs.realpathSync(input.skillDir);
  let fileReal: string;
  try {
    fileReal = fs.realpathSync(candidate);
  } catch (err) {
    const e = err as { code?: unknown };
    if (e && e.code === "ENOENT") throw new Error("Resource not found.");
    throw new Error("Unable to read resource.");
  }

  const prefix = skillReal.endsWith(path.sep) ? skillReal : `${skillReal}${path.sep}`;
  if (!(fileReal === skillReal || fileReal.startsWith(prefix))) {
    throw new Error("Access denied.");
  }

  return { rel: normalized, fullPath: candidate };
}

export function createSkillsTools(input: {
  enabled: boolean;
  chatId?: string;
}): SkillsToolsResult {
  if (!input.enabled) return { enabled: false, tools: {} };

  const cfg = getConfig();
  const maxSkillMdBytes = cfg.skills?.maxSkillMdBytes ?? 200_000;
  const maxResourceBytes = cfg.skills?.maxResourceBytes ?? 2_000_000;
  const maxFrontmatterOverreadBytes = 128_000;

  const skillsActivate = createTool({
    description: "Activate a named skill by loading its SKILL.md instructions.",
    inputSchema: z.object({
      name: z.string().describe("Skill name to activate."),
    }),
    execute: async ({ name }) => {
      try {
      const registry = getSkillsRegistry();
      if (!registry) throw new Error("Skills are disabled.");
      const key = String(name ?? "").trim();
      if (!key) throw new Error("Missing skill name.");
      const record = registry.get(key);
      if (!record) throw new Error(`Unknown skill: ${key}`);

      const initialRead = readUtf8WithSoftByteLimit({
        filePath: record.skillMdPath,
        maxBytes: maxSkillMdBytes,
      });

      let parsed = null as ReturnType<typeof parseSkillMd> | null;
      try {
        parsed = parseSkillMd(initialRead.text);
      } catch (err) {
        if (!initialRead.truncated) throw err;

        const stat = fs.statSync(record.skillMdPath);
        const overreadBytes = Math.min(
          stat.size,
          maxSkillMdBytes + maxFrontmatterOverreadBytes
        );
        const overread = readUtf8WithSoftByteLimit({
          filePath: record.skillMdPath,
          maxBytes: overreadBytes,
        });
        parsed = parseSkillMd(overread.text);
      }

      const body = initialRead.truncated
        ? appendTruncationNotice({
            text: parsed.body,
            removedBytes: initialRead.removedBytes,
            kind: "SKILL.md",
          })
        : parsed.body;

      if (input.chatId) {
        try {
          recordActivatedSkillName({ chatId: input.chatId, skillName: record.name });
        } catch {}
      }

      return {
        name: record.name,
        frontmatter: parsed.frontmatter,
        body,
      };
      } catch (err) {
        throw new Error(sanitizeToolErrorMessage(err));
      }
    },
  });

  const skillsReadResource = createTool({
    description:
      "Read a file from within a skill directory using a relative path from the skill root.",
    inputSchema: z.object({
      name: z.string().describe("Skill name."),
      path: z.string().describe("Relative path from the skill root."),
    }),
    execute: async ({ name, path: relativePath }) => {
      try {
      const registry = getSkillsRegistry();
      if (!registry) throw new Error("Skills are disabled.");
      const key = String(name ?? "").trim();
      if (!key) throw new Error("Missing skill name.");
      const record = registry.get(key);
      if (!record) throw new Error(`Unknown skill: ${key}`);

      const rel = String(relativePath ?? "").trim();
      const resolved = resolveSkillResourcePathOrThrow({
        skillDir: record.skillDir,
        relativePath: rel,
      });

      const read = readUtf8WithSoftByteLimit({
        filePath: resolved.fullPath,
        maxBytes: maxResourceBytes,
      });
      const content = read.truncated
        ? appendTruncationNotice({
            text: read.text,
            removedBytes: read.removedBytes,
            kind: "resource",
          })
        : read.text;

      return {
        name: record.name,
        path: resolved.rel,
        content,
      };
      } catch (err) {
        try {
          const msg = err instanceof Error ? err.message : String(err ?? "");
          let reason: string | null = null;
          if (/Absolute paths are not allowed/.test(msg)) reason = "absolute_path";
          else if (/Path traversal is not allowed/.test(msg)) reason = "path_traversal";
          else if (/Access denied/.test(msg)) reason = "access_denied";
          if (reason) {
            logEvent("warn", "skills.resource_read_blocked", {
              skillName: String(name ?? "").trim(),
              path: String(relativePath ?? "").trim(),
              reason,
            });
          }
        } catch {
          // ignore logging failures
        }
        throw new Error(sanitizeToolErrorMessage(err));
      }
    },
  });

  return {
    enabled: true,
    tools: {
      skillsActivate,
      skillsReadResource,
    },
  };
}
