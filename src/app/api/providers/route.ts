import { getActiveProviderIdFromDb } from "@/server/app-settings";
import { getConfig } from "@/server/config";
import { buildModelsInventory } from "@/server/models-inventory";

export async function GET() {
  try {
    const config = getConfig();
    const storedActiveProviderId = getActiveProviderIdFromDb();
    const providerIds = new Set(config.providers.map((p) => p.id));
    const activeProviderId =
      storedActiveProviderId && providerIds.has(storedActiveProviderId)
        ? storedActiveProviderId
        : config.defaultProviderId;

    const inventory = await buildModelsInventory();

    return Response.json({
      defaultProviderId: config.defaultProviderId,
      activeProviderId,
      webToolsEnabled: Boolean(config.webTools?.enabled),
      providers: config.providers.map((p) => {
        const providerInventory = inventory.providers.find(
          (provider) => provider.id === p.id
        );
        if (!providerInventory) {
          throw new Error(
            `models inventory missing provider "${p.id}". Check config.toml and modelsdev output.`
          );
        }
        const modelsById = new Map(
          providerInventory.models.map((model) => [model.id, model])
        );

        return {
          id: p.id,
          name: p.name,
          defaultModelId: p.defaultModelId,
          models: providerInventory.allowedModelIds.map((modelId) => {
            const model = modelsById.get(modelId);
            if (!model) {
              throw new Error(
                `models inventory missing model "${modelId}" for provider "${p.id}".`
              );
            }
            return {
              type: model.modelType,
              id: model.id,
              label: model.label,
              description: model.description,
              capabilities: model.capabilities,
              contextWindow: model.contextWindow,
            };
          }),
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Failed to load providers: ${err.message}`
            : "Failed to load providers.",
      },
      { status: 500 }
    );
  }
}
