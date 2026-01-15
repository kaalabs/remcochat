import { getActiveProviderIdFromDb } from "@/server/app-settings";
import { getConfig } from "@/server/config";

export async function GET() {
  const config = getConfig();
  const storedActiveProviderId = getActiveProviderIdFromDb();
  const providerIds = new Set(config.providers.map((p) => p.id));
  const activeProviderId =
    storedActiveProviderId && providerIds.has(storedActiveProviderId)
      ? storedActiveProviderId
      : config.defaultProviderId;

  return Response.json({
    defaultProviderId: config.defaultProviderId,
    activeProviderId,
    providers: config.providers.map((p) => ({
      id: p.id,
      name: p.name,
      defaultModelId: p.defaultModelId,
      models: p.models.map((m) => ({
        type: m.type,
        id: m.id,
        label: m.label,
        description: m.description,
        capabilities: m.capabilities,
      })),
    })),
  });
}
