import { getSkillsRegistry, rescanSkillsRegistry } from "@/server/skills/runtime";
import { isRequestAllowedByAdminPolicy } from "@/server/request-auth";
import { redactSkillsRegistrySnapshotForPublic } from "@/server/skills/redact";
import { getSkillsUsageSummary } from "@/server/skills/usage";
import { detectToolDependenciesFromText } from "@/server/readiness/detect";
import fs from "node:fs";
import path from "node:path";

function normalizeDir(p: string): string {
  return path.resolve(String(p ?? "")).replace(/\/+$/, "");
}

function isExistingDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readUtf8Prefix(filePath: string, maxBytes: number): string {
  const limit = Math.max(1_000, Math.floor(maxBytes));
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("Not a file.");

  const toRead = Math.min(stat.size, limit);
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(toRead);
    const bytesRead = fs.readSync(fd, buf, 0, toRead, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function detectToolsBySkillName(snapshot: { skills?: Array<{ name: string; skillMdPath: string }> }) {
  const out = new Map<string, string[]>();
  const maxBytes = 200_000;
  for (const s of snapshot.skills ?? []) {
    try {
      const text = readUtf8Prefix(s.skillMdPath, maxBytes);
      const deps = detectToolDependenciesFromText(text);
      out.set(s.name, deps);
    } catch {
      out.set(s.name, []);
    }
  }
  return out;
}

export function GET(req: Request) {
  const isAdmin = isRequestAllowedByAdminPolicy(req);
  const url = new URL(req.url);
  const forceRescanRaw = String(url.searchParams.get("rescan") ?? "").toLowerCase();
  const forceRescan = forceRescanRaw === "1" || forceRescanRaw === "true";
  const registry = forceRescan && isAdmin ? rescanSkillsRegistry() : getSkillsRegistry();
  if (!registry) {
    return Response.json({
      enabled: false,
      status: { enabled: false, registryLoaded: false },
    });
  }

  const snapshot = registry.snapshot();
  const depsByName = detectToolsBySkillName(snapshot);

  if (!isAdmin) {
    const redacted = redactSkillsRegistrySnapshotForPublic(snapshot) as unknown as {
      skills?: Array<{ name: string } & Record<string, unknown>>;
    };
    return Response.json({
      ...redacted,
      ...(Array.isArray(redacted.skills)
        ? {
            skills: redacted.skills.map((s) => ({
              ...s,
              detectedTools: depsByName.get(s.name) ?? [],
            })),
          }
        : {}),
      status: { enabled: true, registryLoaded: true },
    });
  }

  const scanRootsMeta = (snapshot.scanRoots ?? []).map((root) => {
    const rootNorm = normalizeDir(root);
    const skillsCount =
      snapshot.skills?.filter((s) => normalizeDir(s.sourceDir) === rootNorm).length ?? 0;
    return {
      root,
      exists: isExistingDirectory(root),
      skillsCount,
    };
  });

  return Response.json({
    ...snapshot,
    skills: (snapshot.skills ?? []).map((s) => ({
      ...s,
      detectedTools: depsByName.get(s.name) ?? [],
    })),
    status: { enabled: true, registryLoaded: true },
    usage: getSkillsUsageSummary(),
    scanRootsMeta,
  });
}
