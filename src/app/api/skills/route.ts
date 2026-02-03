import { getSkillsRegistry } from "@/server/skills/runtime";
import { isRequestAllowedByAdminPolicy } from "@/server/request-auth";
import { redactSkillsRegistrySnapshotForPublic } from "@/server/skills/redact";
import { getSkillsUsageSummary } from "@/server/skills/usage";
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

export function GET(req: Request) {
  const registry = getSkillsRegistry();
  if (!registry) {
    return Response.json({
      enabled: false,
      status: { enabled: false, registryLoaded: false },
    });
  }

  const snapshot = registry.snapshot();
  const isAdmin = isRequestAllowedByAdminPolicy(req);

  if (!isAdmin) {
    return Response.json({
      ...redactSkillsRegistrySnapshotForPublic(snapshot),
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
    status: { enabled: true, registryLoaded: true },
    usage: getSkillsUsageSummary(),
    scanRootsMeta,
  });
}
