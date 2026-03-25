import { getActiveProviderIdFromDb } from "@/server/app-settings";
import type { RemcoChatConfig, RemcoChatProvider } from "@/server/config";
import { getConfig } from "@/server/config";
import type { ModelsDevProviderShowResponse } from "@/server/modelsdev";
import {
  modelsdevProviderShow,
  modelsdevTimeoutMs,
  requireModelTypeFromNpm,
  requireModelsDevProviderNpm,
} from "@/server/modelsdev";

export type ProviderSwitcherStatus = "ready" | "degraded";

export type ProviderSwitcherProvider = {
  id: string;
  name: string;
  defaultModelId: string;
  active: boolean;
  default: boolean;
  status: ProviderSwitcherStatus;
  loadError: string | null;
};

export type ProviderSwitcher = {
  loadedAt: string;
  defaultProviderId: string;
  activeProviderId: string;
  providers: ProviderSwitcherProvider[];
};

type BuildProviderSwitcherOptions = {
  config?: RemcoChatConfig;
  storedActiveProviderId?: string | null;
  timeoutMs?: number;
  probeProviderMetadata?: (
    providerId: string,
    timeoutMs: number,
  ) => Promise<ModelsDevProviderShowResponse>;
};

function resolveActiveProviderId(
  config: RemcoChatConfig,
  storedActiveProviderId: string | null | undefined,
): string {
  const providerIds = new Set(config.providers.map((provider) => provider.id));
  return storedActiveProviderId && providerIds.has(storedActiveProviderId)
    ? storedActiveProviderId
    : config.defaultProviderId;
}

function validateProviderMetadata(
  provider: RemcoChatProvider,
  metadata: ModelsDevProviderShowResponse,
) {
  const providerNpm = requireModelsDevProviderNpm(
    provider.modelsdevProviderId,
    metadata.provider,
  );

  for (const modelId of provider.allowedModelIds) {
    const model = metadata.models[modelId];
    if (!model) {
      throw new Error(
        `modelsdev catalog missing model "${modelId}" for provider "${provider.id}".`,
      );
    }

    const npm = String(model.provider?.npm ?? providerNpm).trim() || providerNpm;
    requireModelTypeFromNpm(npm);
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function buildProviderSwitcher(
  options: BuildProviderSwitcherOptions = {},
): Promise<ProviderSwitcher> {
  const config = options.config ?? getConfig();
  const storedActiveProviderId =
    options.storedActiveProviderId ?? getActiveProviderIdFromDb();
  const activeProviderId = resolveActiveProviderId(config, storedActiveProviderId);
  const timeoutMs = options.timeoutMs ?? modelsdevTimeoutMs();
  const probeProviderMetadata =
    options.probeProviderMetadata ?? modelsdevProviderShow;

  const providerProbeEntries = new Map<
    string,
    PromiseSettledResult<ModelsDevProviderShowResponse>
  >();

  const providerIds = Array.from(
    new Set(config.providers.map((provider) => provider.modelsdevProviderId)),
  );
  const providerResults = await Promise.allSettled(
    providerIds.map((providerId) => probeProviderMetadata(providerId, timeoutMs)),
  );
  providerIds.forEach((providerId, index) => {
    providerProbeEntries.set(providerId, providerResults[index]!);
  });

  return {
    loadedAt: new Date().toISOString(),
    defaultProviderId: config.defaultProviderId,
    activeProviderId,
    providers: config.providers.map((provider) => {
      const probeResult = providerProbeEntries.get(provider.modelsdevProviderId);
      let status: ProviderSwitcherStatus = "ready";
      let loadError: string | null = null;

      if (!probeResult) {
        status = "degraded";
        loadError = `modelsdev provider show missing result for "${provider.modelsdevProviderId}".`;
      } else if (probeResult.status === "rejected") {
        status = "degraded";
        loadError = formatError(probeResult.reason);
      } else {
        try {
          validateProviderMetadata(provider, probeResult.value);
        } catch (err) {
          status = "degraded";
          loadError = formatError(err);
        }
      }

      return {
        id: provider.id,
        name: provider.name,
        defaultModelId: provider.defaultModelId,
        active: provider.id === activeProviderId,
        default: provider.id === config.defaultProviderId,
        status,
        loadError,
      };
    }),
  };
}
