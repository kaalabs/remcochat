import { getActiveProviderIdFromDb } from "@/server/app-settings";
import { getConfig } from "@/server/config";
import { getModelsDevCatalog } from "@/server/modelsdev-catalog";

export async function GET() {
  const config = getConfig();
  const storedActiveProviderId = getActiveProviderIdFromDb();
  const providerIds = new Set(config.providers.map((p) => p.id));
  const activeProviderId =
    storedActiveProviderId && providerIds.has(storedActiveProviderId)
      ? storedActiveProviderId
      : config.defaultProviderId;

  let catalog;
  try {
    catalog = await getModelsDevCatalog();
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Failed to load models via modelsdev: ${err.message}`
            : "Failed to load models via modelsdev.",
      },
      { status: 500 }
    );
  }

  return Response.json({
    defaultProviderId: config.defaultProviderId,
    activeProviderId,
    webToolsEnabled: Boolean(config.webTools?.enabled),
    providers: config.providers.map((p) => {
      const providerCatalog = catalog.providers[p.id];
      if (!providerCatalog) {
        throw new Error(
          `modelsdev catalog missing provider "${p.id}". Check config.toml and modelsdev output.`
        );
      }

      return {
        id: p.id,
        name: p.name,
        defaultModelId: p.defaultModelId,
        models: providerCatalog.allowedModelIds.map((modelId) => {
          const model = providerCatalog.models[modelId];
          if (!model) {
            throw new Error(
              `modelsdev catalog missing model "${modelId}" for provider "${p.id}".`
            );
          }
          return {
            type: model.modelType,
            id: model.id,
            label: model.label,
            description: model.description,
            capabilities: model.capabilities,
          };
        }),
      };
    }),
  });
}
