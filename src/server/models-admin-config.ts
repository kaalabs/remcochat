import fs from "node:fs";
import { getConfigFilePath, parseConfigToml, resetConfigCache } from "@/server/config";
import { resetModelsDevCatalogCache } from "@/server/modelsdev-catalog";
import {
  modelsdevProviderShowCached,
  modelsdevTimeoutMs,
  requireModelsDevProviderNpm,
  resetModelsdevProviderShowCache,
  tryModelTypeFromNpm,
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

async function assertSupportedModelsForProvider(input: {
  modelsdevProviderId: string;
  modelIds: string[];
}) {
  const timeoutMs = modelsdevTimeoutMs();
  const show = await modelsdevProviderShowCached(input.modelsdevProviderId, timeoutMs);
  const providerNpm = requireModelsDevProviderNpm(input.modelsdevProviderId, show.provider);

  for (const modelId of input.modelIds) {
    const raw = show.models[modelId];
    if (!raw) {
      throw new Error(
        `modelsdev provider "${input.modelsdevProviderId}" does not include model "${modelId}"`
      );
    }
    const npm = String(raw.provider?.npm ?? providerNpm).trim() || providerNpm;
    const supported = Boolean(tryModelTypeFromNpm(npm));
    if (!supported) {
      throw new Error(
        `Model "${modelId}" is not supported by RemcoChat (unsupported adapter "${npm}").`
      );
    }
  }
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
  if (!nextAllowed.includes(provider.defaultModelId)) {
    throw new Error(
      `allowedModelIds must include the provider default_model_id (${provider.defaultModelId}).`
    );
  }
  if (
    parsed.intentRouter &&
    parsed.intentRouter.providerId === provider.id &&
    !nextAllowed.includes(parsed.intentRouter.modelId)
  ) {
    throw new Error(
      `allowedModelIds must include the router model_id (${parsed.intentRouter.modelId}) for provider "${provider.id}".`
    );
  }

  await assertSupportedModelsForProvider({
    modelsdevProviderId: provider.modelsdevProviderId,
    modelIds: nextAllowed,
  });

  const updatedToml = updateProviderAllowedModelIdsInToml(
    original,
    provider.id,
    nextAllowed
  );

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

  // Ensure the chosen router model is valid for this provider and adapter-supported.
  await assertSupportedModelsForProvider({
    modelsdevProviderId: provider.modelsdevProviderId,
    modelIds: [modelId],
  });

  // Router requires the model to be present in the provider allowlist; auto-include it.
  const nextAllowed = normalizeModelIdList(provider.allowedModelIds.concat(modelId));
  if (!nextAllowed.includes(provider.defaultModelId)) {
    nextAllowed.push(provider.defaultModelId);
    nextAllowed.sort((a, b) => a.localeCompare(b));
  }

  // Validate allowlist models (includes the new router model).
  await assertSupportedModelsForProvider({
    modelsdevProviderId: provider.modelsdevProviderId,
    modelIds: nextAllowed,
  });

  let updatedToml = updateRouterProviderIdInToml(original, providerId);
  updatedToml = updateRouterModelIdInToml(updatedToml, modelId);
  updatedToml = updateProviderAllowedModelIdsInToml(updatedToml, provider.id, nextAllowed);

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

  // Ensure the chosen default model is valid for this provider and adapter-supported.
  await assertSupportedModelsForProvider({
    modelsdevProviderId: provider.modelsdevProviderId,
    modelIds: [defaultModelId],
  });

  // The config schema requires default_model_id to be in allowed_model_ids; auto-include it.
  let nextAllowed = normalizeModelIdList(provider.allowedModelIds.concat(defaultModelId));

  // Keep router requirement valid if it points at this provider.
  if (
    parsed.intentRouter &&
    parsed.intentRouter.providerId === provider.id &&
    !nextAllowed.includes(parsed.intentRouter.modelId)
  ) {
    nextAllowed = normalizeModelIdList(nextAllowed.concat(parsed.intentRouter.modelId));
  }

  // Validate allowlist models (includes the new default, plus router model if needed).
  await assertSupportedModelsForProvider({
    modelsdevProviderId: provider.modelsdevProviderId,
    modelIds: nextAllowed,
  });

  let updatedToml = updateProviderDefaultModelIdInToml(original, provider.id, defaultModelId);
  updatedToml = updateProviderAllowedModelIdsInToml(updatedToml, provider.id, nextAllowed);

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
