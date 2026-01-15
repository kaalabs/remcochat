import type { ModelOption } from "@/lib/models";
import { getActiveProviderIdFromDb } from "@/server/app-settings";
import { getConfig } from "@/server/config";

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

export function listActiveModelOptions(): ModelOption[] {
  const { provider } = getActiveProviderConfig();
  return provider.models.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
  }));
}

export function isModelAllowedForActiveProvider(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const { provider } = getActiveProviderConfig();
  return provider.models.some((m) => m.id === value);
}

export function clampModelIdForActiveProvider(value: unknown): string {
  const { provider } = getActiveProviderConfig();
  if (typeof value === "string" && provider.models.some((m) => m.id === value)) {
    return value;
  }
  return provider.defaultModelId;
}

