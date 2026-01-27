import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  SkillCollision,
  SkillFrontmatter,
  SkillRecord,
  SkillsRegistrySnapshot,
} from "./types";

function looksLikeSkillDir(skillDir: string): { ok: true; skillMdPath: string } | { ok: false } {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  try {
    const stat = fs.statSync(skillMdPath);
    if (!stat.isFile()) return { ok: false };
  } catch {
    return { ok: false };
  }
  return { ok: true, skillMdPath };
}

function parseFrontmatter(content: string): SkillFrontmatter {
  const text = String(content ?? "");
  if (!text.startsWith("---")) {
    throw new Error("Missing YAML frontmatter (expected leading ---)");
  }

  const lines = text.split("\n");
  if (lines.length < 3) throw new Error("Invalid frontmatter: too short");
  if (lines[0].trim() !== "---") throw new Error("Invalid frontmatter start marker");

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) throw new Error("Invalid frontmatter: missing closing ---");

  const yamlText = lines.slice(1, endIndex).join("\n");
  const parsed = YAML.parse(yamlText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid frontmatter: expected a YAML mapping/object");
  }

  const record = parsed as Record<string, unknown>;
  const name = String(record.name ?? "").trim();
  const description = String(record.description ?? "").trim();

  const license = record.license === undefined ? undefined : String(record.license ?? "").trim();
  const compatibility =
    record.compatibility === undefined ? undefined : String(record.compatibility ?? "").trim();

  let metadata: Record<string, string> | undefined;
  if (record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(record.metadata as Record<string, unknown>)) {
      const key = String(k ?? "").trim();
      if (!key) continue;
      out[key] = String(v ?? "");
    }
    metadata = out;
  }

  const allowedToolsRaw = record["allowed-tools"];
  const allowedTools =
    allowedToolsRaw === undefined ? undefined : String(allowedToolsRaw ?? "").trim();

  return {
    name,
    description,
    ...(license ? { license } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(metadata ? { metadata } : {}),
    ...(allowedTools ? { "allowed-tools": allowedTools } : {}),
  };
}

function validateSkillName(name: string) {
  const value = String(name ?? "").trim();
  if (!value) throw new Error("Frontmatter.name is required");
  if (value.length > 64) throw new Error("Frontmatter.name must be at most 64 characters");
  if (!/^[a-z0-9-]+$/.test(value)) {
    throw new Error("Frontmatter.name must contain only lowercase letters, numbers, and hyphens");
  }
  if (value.startsWith("-") || value.endsWith("-")) {
    throw new Error("Frontmatter.name must not start or end with a hyphen");
  }
  if (value.includes("--")) {
    throw new Error("Frontmatter.name must not contain consecutive hyphens");
  }
  return value;
}

function validateDescription(description: string) {
  const value = String(description ?? "").trim();
  if (!value) throw new Error("Frontmatter.description is required");
  if (value.length > 1024) {
    throw new Error("Frontmatter.description must be at most 1024 characters");
  }
  return value;
}

export function discoverSkills(input: {
  scanRoots: string[];
  maxSkills: number;
}): Omit<SkillsRegistrySnapshot, "enabled"> {
  const scannedAt = Date.now();
  const warnings: string[] = [];
  const skills: SkillRecord[] = [];
  const invalid: SkillsRegistrySnapshot["invalid"] = [];
  const collisionsByName = new Map<string, SkillCollision>();
  const winners = new Map<string, SkillRecord>();

  const maxSkills = Math.max(1, Math.floor(Number(input.maxSkills ?? 200)));
  const scanRoots = Array.isArray(input.scanRoots) ? input.scanRoots : [];

  let capped = false;
  for (const root of scanRoots) {
    if (capped) break;
    const scanRoot = String(root ?? "").trim();
    if (!scanRoot) continue;

    let rootStat: fs.Stats | null = null;
    try {
      rootStat = fs.statSync(scanRoot);
    } catch {
      warnings.push(`Skills scan root missing: ${scanRoot}`);
      continue;
    }
    if (!rootStat.isDirectory()) {
      warnings.push(`Skills scan root is not a directory: ${scanRoot}`);
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(scanRoot, { withFileTypes: true });
    } catch (err) {
      warnings.push(
        `Skills scan root unreadable: ${scanRoot} (${err instanceof Error ? err.message : "unknown error"})`
      );
      continue;
    }

    for (const entry of entries) {
      if (capped) break;
      if (!entry.isDirectory()) continue;

      const dirName = entry.name;
      if (!dirName) continue;
      const skillDir = path.join(scanRoot, dirName);
      const probe = looksLikeSkillDir(skillDir);
      if (!probe.ok) continue;

      try {
        const content = fs.readFileSync(probe.skillMdPath, "utf8");
        const fm = parseFrontmatter(content);
        const name = validateSkillName(fm.name);
        const description = validateDescription(fm.description);

        if (name !== dirName) {
          throw new Error(
            `Frontmatter.name must match parent directory name (expected "${dirName}", got "${name}")`
          );
        }

        const record: SkillRecord = {
          name,
          description,
          ...(fm.license ? { license: fm.license } : {}),
          ...(fm.compatibility ? { compatibility: fm.compatibility } : {}),
          ...(fm.metadata ? { metadata: fm.metadata } : {}),
          ...(fm["allowed-tools"] ? { allowedTools: fm["allowed-tools"] } : {}),
          skillDir,
          skillMdPath: probe.skillMdPath,
          sourceDir: scanRoot,
        };

        const existing = winners.get(name);
        if (!existing) {
          winners.set(name, record);
          skills.push(record);
        } else {
          const collision =
            collisionsByName.get(name) ??
            ({
              name,
              winner: existing,
              losers: [],
            } satisfies SkillCollision);
          collision.losers.push(record);
          collisionsByName.set(name, collision);
        }
      } catch (err) {
        invalid.push({
          skillDir,
          skillMdPath: probe.skillMdPath,
          error: err instanceof Error ? err.message : "Invalid skill",
        });
      }

      if (skills.length >= maxSkills && !capped) {
        capped = true;
        warnings.push(`Skills limit reached: max_skills=${maxSkills}`);
      }
    }
  }

  return {
    scannedAt,
    scanRoots,
    skills,
    invalid,
    collisions: Array.from(collisionsByName.values()),
    warnings,
  };
}

