import { getConfig } from "@/server/config";
import { discoverSkills } from "@/server/skills/registry";
import type { SkillRecord, SkillsRegistry, SkillsRegistrySnapshot } from "@/server/skills/types";
import { logEvent } from "@/server/log";
import { redactSkillsRegistrySnapshotForPublic } from "@/server/skills/redact";

let cachedRegistry: SkillsRegistry | null | undefined;

function discoverAndBuildRegistry(): SkillsRegistry | null {
  const cfg = getConfig().skills;
  if (!cfg || !cfg.enabled) {
    return null;
  }

  const discovery = discoverSkills({
    scanRoots: cfg.directories,
    maxSkills: cfg.maxSkills,
  });

  try {
    const redacted = redactSkillsRegistrySnapshotForPublic({
      enabled: true,
      ...discovery,
    });
    logEvent("info", "skills.discovery", {
      scannedAt: discovery.scannedAt,
      scanRoots: redacted.scanRoots,
      skillsCount: discovery.skills.length,
      invalidCount: discovery.invalid.length,
      collisionsCount: discovery.collisions.length,
      warningsCount: discovery.warnings.length,
    });
  } catch {
    // ignore logging failures
  }

  return makeRegistry({
    enabled: true,
    ...discovery,
  });
}

function makeRegistry(snapshot: SkillsRegistrySnapshot): SkillsRegistry {
  const byName = new Map<string, SkillRecord>();
  for (const skill of snapshot.skills) {
    byName.set(skill.name, skill);
  }

  return {
    snapshot() {
      return snapshot;
    },
    get(name: string) {
      const key = String(name ?? "").trim();
      if (!key) return null;
      return byName.get(key) ?? null;
    },
    list() {
      return snapshot.skills.map((s) => ({ name: s.name, description: s.description }));
    },
  };
}

export function getSkillsRegistry(): SkillsRegistry | null {
  if (cachedRegistry !== undefined) return cachedRegistry;

  cachedRegistry = discoverAndBuildRegistry();
  return cachedRegistry;
}

export function rescanSkillsRegistry(): SkillsRegistry | null {
  cachedRegistry = discoverAndBuildRegistry();
  return cachedRegistry;
}

export function _resetSkillsRegistryForTests() {
  cachedRegistry = undefined;
}
