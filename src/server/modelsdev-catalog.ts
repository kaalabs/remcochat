import type { ModelCapabilities } from "@/lib/models";
import type { ModelType, RemcoChatProvider } from "@/server/config";
import { MODEL_TYPES, getConfig } from "@/server/config";
import type {
  ModelsDevModel,
  ModelsDevProvider,
  ModelsDevProviderShowResponse,
} from "@/server/modelsdev";
import {
  descriptionFromModelId,
  getModelsdevVersion,
  modelsdevProviderShow,
  modelsdevTimeoutMs,
  normalizeCapabilities,
  requireModelTypeFromNpm,
  requireModelsDevProviderNpm,
} from "@/server/modelsdev";

export type ModelsDevCatalogModel = {
  id: string;
  label: string;
  description?: string;
  providerModelId: string;
  modelType: ModelType;
  npm: string;
  capabilities: ModelCapabilities;
  raw: ModelsDevModel;
};

export type ModelsDevCatalogProvider = {
  id: string;
  name: string;
  modelsdevProviderId: string;
  defaultModelId: string;
  allowedModelIds: string[];
  apiKeyEnv: string;
  baseUrl: string;
  models: Record<string, ModelsDevCatalogModel>;
  modelsdev: {
    provider: ModelsDevProvider;
  };
};

export type ModelsDevCatalog = {
  loadedAt: string;
  modelsdev: {
    version: string;
    timeoutMs: number;
    allowedModelTypes: readonly ModelType[];
  };
  providers: Record<string, ModelsDevCatalogProvider>;
};

let catalog: ModelsDevCatalog | null = null;
let catalogPromise: Promise<ModelsDevCatalog> | null = null;

function requireModelById(
  providerId: string,
  models: Record<string, ModelsDevModel>,
  modelId: string
): ModelsDevModel {
  const m = models[modelId];
  if (!m) {
    throw new Error(
      `modelsdev provider "${providerId}" does not include model "${modelId}"`
    );
  }
  return m;
}

function buildProviderCatalog(input: {
  provider: RemcoChatProvider;
  modelsdev: ModelsDevProviderShowResponse;
}): ModelsDevCatalogProvider {
  const providerNpm = requireModelsDevProviderNpm(
    input.provider.modelsdevProviderId,
    input.modelsdev.provider
  );

  const models: Record<string, ModelsDevCatalogModel> = {};
  for (const modelId of input.provider.allowedModelIds) {
    const raw = requireModelById(
      input.provider.modelsdevProviderId,
      input.modelsdev.models,
      modelId
    );
    const npm = String(raw.provider?.npm ?? providerNpm).trim() || providerNpm;
    const modelType = requireModelTypeFromNpm(npm);
    models[modelId] = {
      id: modelId,
      label: String(raw.name ?? modelId),
      description: descriptionFromModelId(modelId, npm),
      providerModelId: modelId,
      modelType,
      npm,
      capabilities: normalizeCapabilities(raw),
      raw,
    };
  }

  return {
    id: input.provider.id,
    name: input.provider.name,
    modelsdevProviderId: input.provider.modelsdevProviderId,
    defaultModelId: input.provider.defaultModelId,
    allowedModelIds: input.provider.allowedModelIds,
    apiKeyEnv: input.provider.apiKeyEnv,
    baseUrl: input.provider.baseUrl,
    models,
    modelsdev: { provider: input.modelsdev.provider },
  };
}

async function buildCatalog(): Promise<ModelsDevCatalog> {
  const config = getConfig();
  const timeoutMs = modelsdevTimeoutMs();

  const providerShows = new Map<string, Promise<ModelsDevProviderShowResponse>>();
  for (const provider of config.providers) {
    if (providerShows.has(provider.modelsdevProviderId)) continue;
    providerShows.set(
      provider.modelsdevProviderId,
      modelsdevProviderShow(provider.modelsdevProviderId, timeoutMs)
    );
  }

  const [version, ...providerShowResults] = await Promise.all([
    getModelsdevVersion(),
    ...Array.from(providerShows.values()),
  ]);

  const providerShowByModelsdevId = new Map<string, ModelsDevProviderShowResponse>();
  Array.from(providerShows.keys()).forEach((id, idx) => {
    providerShowByModelsdevId.set(id, providerShowResults[idx]!);
  });

  const providers: Record<string, ModelsDevCatalogProvider> = {};
  for (const provider of config.providers) {
    const modelsdev = providerShowByModelsdevId.get(provider.modelsdevProviderId);
    if (!modelsdev) {
      throw new Error(
        `modelsdev provider show missing result for "${provider.modelsdevProviderId}".`
      );
    }
    providers[provider.id] = buildProviderCatalog({ provider, modelsdev });
  }

  return {
    loadedAt: new Date().toISOString(),
    modelsdev: {
      version,
      timeoutMs,
      allowedModelTypes: MODEL_TYPES,
    },
    providers,
  };
}

export async function getModelsDevCatalog(): Promise<ModelsDevCatalog> {
  if (catalog) return catalog;
  if (!catalogPromise) {
    catalogPromise = buildCatalog().then((built) => {
      catalog = built;
      return built;
    });
  }
  return catalogPromise;
}

export function _resetModelsDevCatalogForTests() {
  catalog = null;
  catalogPromise = null;
}

export function resetModelsDevCatalogCache() {
  catalog = null;
  catalogPromise = null;
}
