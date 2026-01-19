import type { ModelOption } from "@/lib/models";
import { getActiveProviderIdFromDb } from "@/server/app-settings";
import { getConfig } from "@/server/config";
import { getModelsDevCatalog } from "@/server/modelsdev-catalog";

export function getActiveProviderId(): string {
  const config = getConfig();
  const providerIds = new Set(config.providers.map((p) => p.id));
  const stored = getActiveProviderIdFromDb();
  if (stored && providerIds.has(stored)) return stored;
  return config.defaultProviderId;
}

export function getActiveProviderConfig() {
  const config = getConfig();
  const activeProviderId = getActiveProviderId();
  const provider =
    config.providers.find((p) => p.id === activeProviderId) ??
    config.providers.find((p) => p.id === config.defaultProviderId);
  if (!provider) {
    throw new Error("No providers configured in config.toml.");
  }
  return { provider, activeProviderId, config };
}

export async function listActiveModelOptions(): Promise<ModelOption[]> {
  const { activeProviderId } = getActiveProviderConfig();
  const catalog = await getModelsDevCatalog();
  const providerCatalog = catalog.providers[activeProviderId];
  if (!providerCatalog) {
    throw new Error(
      `modelsdev catalog missing provider "${activeProviderId}". Check config.toml and modelsdev output.`
    );
  }

  return providerCatalog.allowedModelIds.map((modelId) => {
    const model = providerCatalog.models[modelId];
    if (!model) {
      throw new Error(
        `modelsdev catalog missing model "${modelId}" for provider "${activeProviderId}".`
      );
    }
    return {
      type: model.modelType,
      id: model.id,
      label: model.label,
      description: model.description,
      capabilities: model.capabilities,
    };
  });
}

export function isModelAllowedForActiveProvider(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const { provider } = getActiveProviderConfig();
  return provider.allowedModelIds.includes(value);
}

export function clampModelIdForActiveProvider(value: unknown): string {
  const { provider } = getActiveProviderConfig();
  if (typeof value === "string" && provider.allowedModelIds.includes(value)) {
    return value;
  }
  return provider.defaultModelId;
}
