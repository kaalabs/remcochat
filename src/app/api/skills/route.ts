import { getSkillsRegistry } from "@/server/skills/runtime";
import { isRequestAllowedByAdminPolicy } from "@/server/request-auth";
import { redactSkillsRegistrySnapshotForPublic } from "@/server/skills/redact";
import { getSkillsUsageSummary } from "@/server/skills/usage";

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

  return Response.json({
    ...snapshot,
    status: { enabled: true, registryLoaded: true },
    usage: getSkillsUsageSummary(),
  });
}
