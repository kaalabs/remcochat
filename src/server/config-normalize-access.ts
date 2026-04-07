import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RemcoChatConfig } from "./config-types";
import type {
  RawLocalAccessConfig,
  RawSkillsConfig,
} from "./config-normalize-types";
import { clampInt } from "./config-normalize-shared";

export function normalizeLocalAccess(
  rawLocalAccess: RawLocalAccessConfig | undefined
): RemcoChatConfig["localAccess"] {
  const localAccess = rawLocalAccess ?? {};
  if (!Boolean(localAccess.enabled ?? false)) {
    return null;
  }

  const repoBaseDir = process.cwd();
  const homeDir = os.homedir();

  const resolveDirEntry = (dir: string): string[] => {
    const trimmed = String(dir ?? "").trim();
    if (!trimmed) return [];
    if (trimmed === "~") return [homeDir];
    if (trimmed.startsWith("~/")) return [path.join(homeDir, trimmed.slice(2))];
    if (path.isAbsolute(trimmed)) return [trimmed];
    return [path.resolve(repoBaseDir, trimmed)];
  };

  const rawAllowedDirs = Array.isArray(localAccess.allowed_directories)
    ? localAccess.allowed_directories.map((dir) => String(dir).trim()).filter(Boolean)
    : [];
  const rawAllowedCommands = Array.isArray(localAccess.allowed_commands)
    ? localAccess.allowed_commands.map((command) => String(command).trim()).filter(Boolean)
    : [];

  const allowedDirectories: string[] = [];
  const seenDirectories = new Set<string>();
  for (const entry of rawAllowedDirs) {
    for (const resolved of resolveDirEntry(entry)) {
      const normalized = String(resolved ?? "").trim().replace(/[\\/]+$/, "");
      if (!normalized || seenDirectories.has(normalized)) {
        continue;
      }
      seenDirectories.add(normalized);
      allowedDirectories.push(normalized);
    }
  }

  const allowedCommands: string[] = [];
  const seenCommands = new Set<string>();
  for (const entry of rawAllowedCommands) {
    const normalized = String(entry ?? "").trim();
    if (!normalized || seenCommands.has(normalized)) {
      continue;
    }
    seenCommands.add(normalized);
    allowedCommands.push(normalized);
  }

  return {
    enabled: true,
    allowedCommands,
    allowedDirectories,
  };
}

function getUpTreeAgentsSkillsDirs(startDir: string): string[] {
  const start = path.resolve(String(startDir ?? "")).replace(/\/+$/, "");
  if (!start) return [];

  const directories: string[] = [];
  const seen = new Set<string>();

  const startCandidate = path.join(start, ".agents", "skills").replace(/\/+$/, "");
  if (!seen.has(startCandidate)) {
    seen.add(startCandidate);
    directories.push(startCandidate);
  }

  let current = start;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;

    const candidate = path.join(current, ".agents", "skills");
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isDirectory()) {
        continue;
      }
      const normalized = candidate.replace(/\/+$/, "");
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      directories.push(normalized);
    } catch {
      // Ignore missing/unreadable candidates during up-tree scanning.
    }
  }

  return directories;
}

export function normalizeSkills(
  rawSkills: RawSkillsConfig | undefined
): RemcoChatConfig["skills"] {
  const skills = rawSkills ?? {};
  if (!Boolean(skills.enabled ?? false)) {
    return null;
  }

  const repoBaseDir = process.cwd();
  const homeDir = os.homedir();
  const defaultDirectories = [
    "./.skills",
    "./.agents/skills",
    path.join(homeDir, ".agents", "skills"),
    path.join(homeDir, ".remcochat", "skills"),
  ];
  const inputDirectoriesRaw = Array.isArray(skills.directories)
    ? skills.directories.map((dir) => String(dir).trim()).filter(Boolean)
    : [];
  const inputDirectories =
    inputDirectoriesRaw.length > 0 ? inputDirectoriesRaw : defaultDirectories;

  const isUpTreeAgentsEntry = (dir: string) => {
    const trimmed = String(dir ?? "").trim().replace(/\/+$/, "");
    return trimmed === ".agents/skills" || trimmed === "./.agents/skills";
  };

  const resolveDirs = (dir: string): string[] => {
    const trimmed = String(dir ?? "").trim();
    if (!trimmed) return [];
    if (isUpTreeAgentsEntry(trimmed)) {
      return getUpTreeAgentsSkillsDirs(repoBaseDir);
    }
    if (trimmed === "~") return [homeDir];
    if (trimmed.startsWith("~/")) return [path.join(homeDir, trimmed.slice(2))];
    if (path.isAbsolute(trimmed)) return [trimmed];
    return [path.resolve(repoBaseDir, trimmed)];
  };

  const directories: string[] = [];
  const seen = new Set<string>();
  for (const entry of inputDirectories) {
    for (const resolved of resolveDirs(entry)) {
      if (!resolved) {
        continue;
      }
      const normalized = resolved.replace(/\/+$/, "");
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      directories.push(normalized);
    }
  }

  return {
    enabled: true,
    directories,
    maxSkills: clampInt(skills.max_skills, 1, 10_000, 200),
    maxSkillMdBytes: clampInt(skills.max_skill_md_bytes, 1_000, 50_000_000, 200_000),
    maxResourceBytes: clampInt(skills.max_resource_bytes, 1_000, 200_000_000, 2_000_000),
  };
}
