import fs from "node:fs";
import { getConfigFilePath, parseConfigToml, resetConfigCache } from "@/server/config";
import { resetModelsDevCatalogCache } from "@/server/modelsdev-catalog";
import {
  isSupportedProviderModel,
  modelsdevProviderShowCached,
  modelsdevTimeoutMs,
  requireModelsDevProviderNpm,
  resetModelsdevProviderShowCache,
} from "@/server/modelsdev";
import {
  updateProviderAllowedModelIdsInToml,
  updateProviderDefaultModelIdInToml,
  updateRouterModelIdInToml,
  updateRouterProviderIdInToml,
  updateWebToolsSearchProviderInToml,
  writeFileAtomic,
} from "@/server/config-toml-edit";

function normalizeModelIdList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const trimmed = String(v ?? "").trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  out.sort((a, b) => a.localeCompare(b)); // decision 1.B
  return out;
}

async function getSupportedModelIdsForProvider(input: {
  providerId: string;
  modelsdevProviderId: string;
}): Promise<Set<string>> {
  const timeoutMs = modelsdevTimeoutMs();
  const show = await modelsdevProviderShowCached(input.modelsdevProviderId, timeoutMs);
  const providerNpm = requireModelsDevProviderNpm(input.modelsdevProviderId, show.provider);
  const supportedModelIds = new Set<string>();

  for (const [modelId, raw] of Object.entries(show.models)) {
    const npm = String(raw.provider?.npm ?? providerNpm).trim() || providerNpm;
    if (
      isSupportedProviderModel({
        providerId: input.providerId,
        modelId,
        npm,
      })
    ) {
      supportedModelIds.add(modelId);
    }
  }

  return supportedModelIds;
}

function assertModelIdsSupported(input: {
  providerId: string;
  modelIds: string[];
  supportedModelIds: Set<string>;
}) {
  for (const modelId of input.modelIds) {
    if (!input.supportedModelIds.has(modelId)) {
      throw new Error(
        `modelsdev provider "${input.providerId}" does not include model "${modelId}"`
      );
    }
  }
}

function pickFallbackModelId(modelIds: string[]): string {
  const fallback = modelIds[0];
  if (!fallback) {
    throw new Error("No supported models remain for this provider.");
  }
  return fallback;
}

export function reconcileProviderModelReferences(input: {
  allowedModelIds: string[];
  currentDefaultModelId: string;
  currentRouterModelId?: string | null;
  supportedModelIds: Iterable<string>;
}): {
  allowedModelIds: string[];
  defaultModelId: string;
  routerModelId: string | null;
} {
  const supportedModelIds = new Set(input.supportedModelIds);
  const allowedModelIds = normalizeModelIdList(input.allowedModelIds);

  if (allowedModelIds.length === 0) {
    throw new Error("No supported models remain for this provider.");
  }

  const defaultModelId =
    allowedModelIds.includes(input.currentDefaultModelId) &&
    supportedModelIds.has(input.currentDefaultModelId)
      ? input.currentDefaultModelId
      : pickFallbackModelId(allowedModelIds);

  const currentRouterModelId = String(input.currentRouterModelId ?? "").trim();
  const routerModelId = currentRouterModelId
    ? allowedModelIds.includes(currentRouterModelId) &&
      supportedModelIds.has(currentRouterModelId)
      ? currentRouterModelId
      : defaultModelId
    : null;

  return {
    allowedModelIds,
    defaultModelId,
    routerModelId,
  };
}

export async function updateProviderAllowedModelsInConfigToml(input: {
  providerId: string;
  allowedModelIds: string[];
}) {
  const filePath = getConfigFilePath();
  const original = fs.readFileSync(filePath, "utf8");
  const parsed = parseConfigToml(original);

  const provider = parsed.providers.find((p) => p.id === input.providerId);
  if (!provider) {
    throw new Error(`Unknown providerId: ${input.providerId}`);
  }

  const nextAllowed = normalizeModelIdList(input.allowedModelIds);
  if (nextAllowed.length === 0) {
    throw new Error("allowedModelIds must not be empty.");
  }
  const supportedModelIds = await getSupportedModelIdsForProvider({
    providerId: provider.id,
    modelsdevProviderId: provider.modelsdevProviderId,
  });
  assertModelIdsSupported({
    providerId: provider.modelsdevProviderId,
    modelIds: nextAllowed,
    supportedModelIds,
  });

  const reconciled = reconcileProviderModelReferences({
    allowedModelIds: nextAllowed,
    currentDefaultModelId: provider.defaultModelId,
    currentRouterModelId:
      parsed.intentRouter && parsed.intentRouter.providerId === provider.id
        ? parsed.intentRouter.modelId
        : null,
    supportedModelIds,
  });

  let updatedToml = updateProviderAllowedModelIdsInToml(
    original,
    provider.id,
    reconciled.allowedModelIds
  );
  if (reconciled.defaultModelId !== provider.defaultModelId) {
    updatedToml = updateProviderDefaultModelIdInToml(
      updatedToml,
      provider.id,
      reconciled.defaultModelId
    );
  }
  if (
    reconciled.routerModelId &&
    parsed.intentRouter &&
    parsed.intentRouter.providerId === provider.id &&
    reconciled.routerModelId !== parsed.intentRouter.modelId
  ) {
    updatedToml = updateRouterModelIdInToml(updatedToml, reconciled.routerModelId);
  }

  // Fail-fast: ensure we are not about to write an invalid config.
  parseConfigToml(updatedToml);

  writeFileAtomic(filePath, updatedToml);
  resetConfigCache();
  resetModelsDevCatalogCache();
  resetModelsdevProviderShowCache();
}

export async function updateRouterModelInConfigToml(input: {
  modelId: string;
  providerId?: string;
}) {
  const modelId = String(input.modelId ?? "").trim();
  if (!modelId) {
    throw new Error("Missing modelId.");
  }

  const filePath = getConfigFilePath();
  const original = fs.readFileSync(filePath, "utf8");
  const parsed = parseConfigToml(original);

  if (!parsed.intentRouter) {
    throw new Error("Router is not enabled in config.toml.");
  }

  const providerId = String(input.providerId ?? parsed.intentRouter.providerId ?? "").trim();
  if (!providerId) {
    throw new Error("Missing providerId.");
  }
  const provider = parsed.providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new Error(`Router provider_id "${providerId}" is not present in providers.`);
  }

  const supportedModelIds = await getSupportedModelIdsForProvider({
    providerId: provider.id,
    modelsdevProviderId: provider.modelsdevProviderId,
  });
  assertModelIdsSupported({
    providerId: provider.modelsdevProviderId,
    modelIds: [modelId],
    supportedModelIds,
  });

  // Router requires the model to be present in the provider allowlist; auto-include it.
  const nextAllowed = normalizeModelIdList(
    provider.allowedModelIds
      .filter((candidate) => supportedModelIds.has(candidate))
      .concat(modelId)
  );
  const reconciled = reconcileProviderModelReferences({
    allowedModelIds: nextAllowed,
    currentDefaultModelId: provider.defaultModelId,
    currentRouterModelId: modelId,
    supportedModelIds,
  });

  let updatedToml = updateRouterProviderIdInToml(original, providerId);
  updatedToml = updateRouterModelIdInToml(updatedToml, modelId);
  if (reconciled.defaultModelId !== provider.defaultModelId) {
    updatedToml = updateProviderDefaultModelIdInToml(
      updatedToml,
      provider.id,
      reconciled.defaultModelId
    );
  }
  updatedToml = updateProviderAllowedModelIdsInToml(
    updatedToml,
    provider.id,
    reconciled.allowedModelIds
  );

  parseConfigToml(updatedToml);

  writeFileAtomic(filePath, updatedToml);
  resetConfigCache();
  resetModelsDevCatalogCache();
  resetModelsdevProviderShowCache();
}

export async function updateProviderDefaultModelInConfigToml(input: {
  providerId: string;
  defaultModelId: string;
}) {
  const providerId = String(input.providerId ?? "").trim();
  if (!providerId) throw new Error("Missing providerId.");
  const defaultModelId = String(input.defaultModelId ?? "").trim();
  if (!defaultModelId) throw new Error("Missing defaultModelId.");

  const filePath = getConfigFilePath();
  const original = fs.readFileSync(filePath, "utf8");
  const parsed = parseConfigToml(original);

  const provider = parsed.providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new Error(`Unknown providerId: ${providerId}`);
  }

  const supportedModelIds = await getSupportedModelIdsForProvider({
    providerId: provider.id,
    modelsdevProviderId: provider.modelsdevProviderId,
  });
  assertModelIdsSupported({
    providerId: provider.modelsdevProviderId,
    modelIds: [defaultModelId],
    supportedModelIds,
  });

  const nextAllowed = normalizeModelIdList(
    provider.allowedModelIds
      .filter((candidate) => supportedModelIds.has(candidate))
      .concat(defaultModelId)
  );
  const reconciled = reconcileProviderModelReferences({
    allowedModelIds: nextAllowed,
    currentDefaultModelId: defaultModelId,
    currentRouterModelId:
      parsed.intentRouter && parsed.intentRouter.providerId === provider.id
        ? parsed.intentRouter.modelId
        : null,
    supportedModelIds,
  });

  let updatedToml = updateProviderDefaultModelIdInToml(original, provider.id, defaultModelId);
  updatedToml = updateProviderAllowedModelIdsInToml(
    updatedToml,
    provider.id,
    reconciled.allowedModelIds
  );
  if (
    reconciled.routerModelId &&
    parsed.intentRouter &&
    parsed.intentRouter.providerId === provider.id &&
    reconciled.routerModelId !== parsed.intentRouter.modelId
  ) {
    updatedToml = updateRouterModelIdInToml(updatedToml, reconciled.routerModelId);
  }

  parseConfigToml(updatedToml);

  writeFileAtomic(filePath, updatedToml);
  resetConfigCache();
  resetModelsDevCatalogCache();
  resetModelsdevProviderShowCache();
}

export async function updateWebToolsSearchProviderInConfigToml(input: {
  searchProvider: "exa" | "brave";
}) {
  const searchProvider = input.searchProvider;
  const filePath = getConfigFilePath();
  const original = fs.readFileSync(filePath, "utf8");
  const parsed = parseConfigToml(original);

  if (!parsed.webTools || !parsed.webTools.enabled) {
    throw new Error("Web tools are not enabled in config.toml.");
  }

  const updatedToml = updateWebToolsSearchProviderInToml(original, searchProvider);
  parseConfigToml(updatedToml);

  writeFileAtomic(filePath, updatedToml);
  resetConfigCache();
  resetModelsDevCatalogCache();
  resetModelsdevProviderShowCache();
}
