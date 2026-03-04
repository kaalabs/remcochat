import fs from "node:fs";
import path from "node:path";
import type { RemcoChatConfig } from "@/server/config";
import { logEvent } from "@/server/log";

export type LocalAccessPolicy = NonNullable<RemcoChatConfig["localAccess"]>;

function normalizeTrailingSeparators(p: string): string {
  return String(p ?? "").replace(/[\\/]+$/, "");
}

function isPolicyEnabled(cfg: RemcoChatConfig | null | undefined): cfg is RemcoChatConfig {
  return Boolean(cfg && cfg.localAccess && cfg.localAccess.enabled);
}

function commandIsPathLike(command: string): boolean {
  const c = String(command ?? "");
  return c.includes("/") || c.includes("\\");
}

function realpathBestEffort(inputPath: string): string {
  const resolved = path.resolve(String(inputPath ?? ""));
  try {
    return normalizeTrailingSeparators(fs.realpathSync(resolved));
  } catch {
    // If the path doesn't exist yet (common for "write" targets), try to resolve
    // the nearest existing ancestor to avoid symlink alias mismatches like /var vs /private/var.
    const suffixParts: string[] = [];
    let current = resolved;
    for (let i = 0; i < 64; i += 1) {
      try {
        const realAncestor = normalizeTrailingSeparators(fs.realpathSync(current));
        const suffix = suffixParts.reverse().join(path.sep);
        return suffix ? normalizeTrailingSeparators(path.join(realAncestor, suffix)) : realAncestor;
      } catch {
        // keep walking
      }

      const parent = path.dirname(current);
      if (!parent || parent === current) break;
      suffixParts.push(path.basename(current));
      current = parent;
    }

    return normalizeTrailingSeparators(resolved);
  }
}

function isUnderDir(baseDir: string, targetPath: string): boolean {
  const base = normalizeTrailingSeparators(baseDir);
  const target = normalizeTrailingSeparators(targetPath);
  if (!base || !target) return false;
  if (base === target) return true;

  const rel = path.relative(base, target);
  if (!rel) return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

function summarizeAllowed(values: string[], max = 6): string[] {
  const out = values.slice(0, Math.max(0, max));
  if (values.length > out.length) out.push(`…(+${values.length - out.length} more)`);
  return out;
}

export function requireLocalCommandAllowed(input: {
  cfg: RemcoChatConfig;
  command: string;
  feature: string;
}) {
  if (!isPolicyEnabled(input.cfg)) return;

  const policy = input.cfg.localAccess!;
  const allowed = Array.isArray(policy.allowedCommands) ? policy.allowedCommands : [];
  const commandRaw = String(input.command ?? "").trim();
  const feature = String(input.feature ?? "").trim() || "unknown";

  if (!commandRaw) {
    logEvent("warn", "local_access.command_blocked", {
      feature,
      command: "",
      reason: "missing_command",
    });
    throw new Error("Local command execution blocked by whitelist.");
  }

  if (allowed.length === 0) {
    logEvent("warn", "local_access.command_blocked", {
      feature,
      command: commandRaw,
      reason: "empty_allowlist",
    });
    throw new Error("Local command execution blocked by whitelist.");
  }

  if (allowed.includes("*")) return;

  const base = path.basename(commandRaw);
  if (allowed.includes(commandRaw) || allowed.includes(base)) return;

  if (commandIsPathLike(commandRaw)) {
    const real = realpathBestEffort(commandRaw);
    if (allowed.includes(real) || allowed.includes(path.basename(real))) return;
  }

  logEvent("warn", "local_access.command_blocked", {
    feature,
    command: commandRaw,
    allowed: summarizeAllowed(allowed),
  });
  throw new Error("Local command execution blocked by whitelist.");
}

export function requireLocalPathAllowed(input: {
  cfg: RemcoChatConfig;
  localPath: string;
  feature: string;
  operation: "read" | "write" | "scan" | "seed";
}) {
  if (!isPolicyEnabled(input.cfg)) return;

  const policy = input.cfg.localAccess!;
  const allowedDirs = Array.isArray(policy.allowedDirectories)
    ? policy.allowedDirectories
    : [];
  const localPathRaw = String(input.localPath ?? "").trim();
  const feature = String(input.feature ?? "").trim() || "unknown";

  if (!localPathRaw) {
    logEvent("warn", "local_access.path_blocked", {
      feature,
      operation: input.operation,
      path: "",
      reason: "missing_path",
    });
    throw new Error("Local filesystem access blocked by whitelist.");
  }

  if (allowedDirs.length === 0) {
    logEvent("warn", "local_access.path_blocked", {
      feature,
      operation: input.operation,
      path: localPathRaw,
      reason: "empty_allowlist",
    });
    throw new Error("Local filesystem access blocked by whitelist.");
  }

  if (allowedDirs.includes("*")) return;

  const targetReal = realpathBestEffort(localPathRaw);
  for (const dir of allowedDirs) {
    const baseReal = realpathBestEffort(dir);
    if (isUnderDir(baseReal, targetReal)) return;
  }

  logEvent("warn", "local_access.path_blocked", {
    feature,
    operation: input.operation,
    path: targetReal,
    allowed: summarizeAllowed(allowedDirs),
  });
  throw new Error("Local filesystem access blocked by whitelist.");
}
