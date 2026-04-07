import type { RawRemcoChatConfig } from "./config-schema";
import type { RemcoChatProvider } from "./config-types";

export function normalizeProviders(
  rawProviders: RawRemcoChatConfig["providers"]
): RemcoChatProvider[] {
  const providers: RemcoChatProvider[] = [];
  for (const [id, provider] of Object.entries(rawProviders)) {
    providers.push({
      id,
      name: provider.name,
      defaultModelId: provider.default_model_id,
      modelsdevProviderId: provider.modelsdev_provider_id ?? id,
      allowedModelIds: Array.from(new Set(provider.allowed_model_ids)),
      baseUrl: provider.base_url,
      apiKeyEnv: provider.api_key_env,
    });
  }
  return providers;
}

export function assertValidProviders(
  providers: RemcoChatProvider[],
  defaultProviderId: string
) {
  if (providers.length === 0) {
    throw new Error(
      "config.toml: at least one provider must be configured under [providers.<id>]"
    );
  }

  const providerIds = new Set(providers.map((provider) => provider.id));
  if (!providerIds.has(defaultProviderId)) {
    throw new Error(
      `config.toml: app.default_provider_id "${defaultProviderId}" is not present in providers`
    );
  }

  for (const provider of providers) {
    const modelIds = new Set(provider.allowedModelIds);
    if (!modelIds.has(provider.defaultModelId)) {
      throw new Error(
        `config.toml: providers.${provider.id}.default_model_id "${provider.defaultModelId}" is not present in providers.${provider.id}.allowed_model_ids`
      );
    }
  }
}
