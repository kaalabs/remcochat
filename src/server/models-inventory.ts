import type { ModelCapabilities } from "@/lib/models";
import { getConfig } from "@/server/config";
import type { ModelType } from "@/server/config";
import {
  descriptionFromModelId,
  getModelsdevVersion,
  modelsdevProviderShowCached,
  modelsdevTimeoutMs,
  normalizeCapabilities,
  requireModelsDevProviderNpm,
  tryModelTypeFromNpm,
} from "@/server/modelsdev";

export type ModelsInventoryModel = {
  id: string;
  label: string;
  description?: string;
  npm: string | null;
  modelType: ModelType | null;
  supported: boolean;
  capabilities: ModelCapabilities;
};

export type ModelsInventoryProvider = {
  id: string;
  name: string;
  modelsdevProviderId: string;
  defaultModelId: string;
  allowedModelIds: string[];
  requiredModelIds: string[];
  apiKeyEnv: string;
  baseUrl: string;
  models: ModelsInventoryModel[];
};

export type ModelsInventory = {
  loadedAt: string;
  modelsdevVersion: string;
  router: { enabled: boolean; providerId: string; modelId: string } | null;
  providers: ModelsInventoryProvider[];
};

export async function buildModelsInventory(): Promise<ModelsInventory> {
  const config = getConfig();
  const timeoutMs = modelsdevTimeoutMs();

  const router = config.intentRouter
    ? {
        enabled: true,
        providerId: config.intentRouter.providerId,
        modelId: config.intentRouter.modelId,
      }
    : null;

  const providerShows = new Map<
    string,
    Promise<Awaited<ReturnType<typeof modelsdevProviderShowCached>>>
  >();
  for (const provider of config.providers) {
    if (providerShows.has(provider.modelsdevProviderId)) continue;
    providerShows.set(
      provider.modelsdevProviderId,
      modelsdevProviderShowCached(provider.modelsdevProviderId, timeoutMs)
    );
  }

  const [modelsdevVersion, ...providerShowResults] = await Promise.all([
    getModelsdevVersion(),
    ...Array.from(providerShows.values()),
  ]);

  const providerShowByModelsdevId = new Map<
    string,
    Awaited<ReturnType<typeof modelsdevProviderShowCached>>
  >();
  Array.from(providerShows.keys()).forEach((id, idx) => {
    providerShowByModelsdevId.set(id, providerShowResults[idx]!);
  });

  const providers: ModelsInventoryProvider[] = [];
  for (const provider of config.providers) {
    const modelsdev = providerShowByModelsdevId.get(provider.modelsdevProviderId);
    if (!modelsdev) {
      throw new Error(
        `modelsdev provider show missing result for "${provider.modelsdevProviderId}".`
      );
    }

    const providerNpm = (() => {
      try {
        return requireModelsDevProviderNpm(provider.modelsdevProviderId, modelsdev.provider);
      } catch {
        return "";
      }
    })();

    const models: ModelsInventoryModel[] = Object.entries(modelsdev.models)
      .map(([modelId, raw]) => {
        const npm = String(raw.provider?.npm ?? providerNpm).trim() || null;
        const modelType = npm ? tryModelTypeFromNpm(npm) : null;
        return {
          id: modelId,
          label: String(raw.name ?? modelId),
          description: npm ? descriptionFromModelId(modelId, npm) : undefined,
          npm,
          modelType,
          supported: Boolean(modelType),
          capabilities: normalizeCapabilities(raw),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const required = new Set<string>();
    required.add(provider.defaultModelId);
    if (router && router.providerId === provider.id) required.add(router.modelId);

    providers.push({
      id: provider.id,
      name: provider.name,
      modelsdevProviderId: provider.modelsdevProviderId,
      defaultModelId: provider.defaultModelId,
      allowedModelIds: provider.allowedModelIds.slice().sort((a, b) => a.localeCompare(b)),
      requiredModelIds: Array.from(required).sort((a, b) => a.localeCompare(b)),
      apiKeyEnv: provider.apiKeyEnv,
      baseUrl: provider.baseUrl,
      models,
    });
  }

  providers.sort((a, b) => a.id.localeCompare(b.id));

  return {
    loadedAt: new Date().toISOString(),
    modelsdevVersion,
    router,
    providers,
  };
}
