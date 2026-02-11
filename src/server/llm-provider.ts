import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import type { ModelCapabilities } from "@/lib/models";
import type { ModelType, RemcoChatProvider } from "@/server/config";
import { getConfig } from "@/server/config";
import { getActiveProviderConfig } from "@/server/model-registry";
import { getModelsDevCatalog } from "@/server/modelsdev-catalog";

type ResolvedModel = {
  providerId: string;
  modelType: ModelType;
  modelId: string;
  providerModelId: string;
  capabilities: ModelCapabilities;
  model: LanguageModel;
};

function requiredEnv(name: string, providerId: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name} for provider "${providerId}".`
    );
  }
  return value;
}

async function resolveProviderModel(
  provider: RemcoChatProvider,
  modelId: unknown
): Promise<{
  resolvedModelId: string;
  providerModelId: string;
  modelType: ModelType;
  capabilities: ModelCapabilities;
}> {
  const resolvedModelId =
    typeof modelId === "string" && provider.allowedModelIds.includes(modelId)
      ? modelId
      : provider.defaultModelId;

  const catalog = await getModelsDevCatalog();
  const providerCatalog = catalog.providers[provider.id];
  if (!providerCatalog) {
    throw new Error(
      `modelsdev catalog missing provider "${provider.id}". Check config.toml and modelsdev output.`
    );
  }

  const model =
    providerCatalog.models[resolvedModelId] ??
    providerCatalog.models[provider.defaultModelId];
  if (!model) {
    throw new Error(
      `modelsdev catalog missing model "${resolvedModelId}" for provider "${provider.id}".`
    );
  }

  return {
    resolvedModelId: model.id,
    providerModelId: model.providerModelId,
    modelType: model.modelType,
    capabilities: model.capabilities,
  };
}

const gatewayClients = new Map<string, ReturnType<typeof createGateway>>();

function getVercelGatewayClient(provider: RemcoChatProvider) {
  const cached = gatewayClients.get(provider.id);
  if (cached) return cached;

  const apiKey = requiredEnv(provider.apiKeyEnv, provider.id);
  const client = createGateway({
    apiKey,
    baseURL: provider.baseUrl,
  });
  gatewayClients.set(provider.id, client);
  return client;
}

const openaiClients = new Map<
  string,
  ReturnType<typeof createOpenAI>
>();

function getOpenAIResponsesClient(provider: RemcoChatProvider) {
  const cached = openaiClients.get(provider.id);
  if (cached) return cached;

  const apiKey = requiredEnv(provider.apiKeyEnv, provider.id);
  const client = createOpenAI({ baseURL: provider.baseUrl, apiKey });
  openaiClients.set(provider.id, client);
  return client;
}

const openaiCompatibleClients = new Map<
  string,
  ReturnType<typeof createOpenAICompatible>
>();

function getOpenAICompatibleClient(provider: RemcoChatProvider) {
  const cached = openaiCompatibleClients.get(provider.id);
  if (cached) return cached;

  const apiKey = requiredEnv(provider.apiKeyEnv, provider.id);
  const client = createOpenAICompatible({
    name: provider.id,
    apiKey,
    baseURL: provider.baseUrl,
  });
  openaiCompatibleClients.set(provider.id, client);
  return client;
}

const xaiClients = new Map<
  string,
  ReturnType<typeof createXai>
>();

function getXaiClient(provider: RemcoChatProvider) {
  const cached = xaiClients.get(provider.id);
  if (cached) return cached;

  const apiKey = requiredEnv(provider.apiKeyEnv, provider.id);
  const client = createXai({
    apiKey,
    baseURL: provider.baseUrl,
  });
  xaiClients.set(provider.id, client);
  return client;
}

const anthropicClients = new Map<
  string,
  ReturnType<typeof createAnthropic>
>();

function getAnthropicCompatibleClient(provider: RemcoChatProvider) {
  const cached = anthropicClients.get(provider.id);
  if (cached) return cached;

  const apiKey = requiredEnv(provider.apiKeyEnv, provider.id);
  const client = createAnthropic({ baseURL: provider.baseUrl, apiKey });
  anthropicClients.set(provider.id, client);
  return client;
}

const googleClients = new Map<
  string,
  ReturnType<typeof createGoogleGenerativeAI>
>();

function getGoogleGenerativeAIClient(provider: RemcoChatProvider) {
  const cached = googleClients.get(provider.id);
  if (cached) return cached;

  const apiKey = requiredEnv(provider.apiKeyEnv, provider.id);
  const client = createGoogleGenerativeAI({
    name: provider.id,
    apiKey,
    baseURL: provider.baseUrl,
  });
  googleClients.set(provider.id, client);
  return client;
}

function getProviderById(providerId: string): RemcoChatProvider {
  const config = getConfig();
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new Error(`Provider "${providerId}" is not present in config.toml.`);
  }
  return provider;
}

async function resolveModelForProvider(
  providerId: string,
  provider: RemcoChatProvider,
  modelId: unknown
): Promise<ResolvedModel> {
  const { resolvedModelId, providerModelId, modelType, capabilities } =
    await resolveProviderModel(provider, modelId);

  switch (modelType) {
    case "vercel_ai_gateway": {
      const gateway = getVercelGatewayClient(provider);
      return {
        providerId,
        modelType,
        modelId: resolvedModelId,
        providerModelId,
        capabilities,
        model: gateway(providerModelId),
      };
    }
    case "openai_responses": {
      const openai = getOpenAIResponsesClient(provider);
      return {
        providerId,
        modelType,
        modelId: resolvedModelId,
        providerModelId,
        capabilities,
        model: openai(providerModelId),
      };
    }
    case "openai_compatible": {
      const openaiCompatible = getOpenAICompatibleClient(provider);
      return {
        providerId,
        modelType,
        modelId: resolvedModelId,
        providerModelId,
        capabilities,
        model: openaiCompatible.chatModel(providerModelId),
      };
    }
    case "xai": {
      const xai = getXaiClient(provider);
      return {
        providerId,
        modelType,
        modelId: resolvedModelId,
        providerModelId,
        capabilities,
        // Use xAI Responses API for chat flows to stay aligned with current
        // xAI tooling direction and avoid deprecated live-search chat behavior.
        model: xai.responses(providerModelId),
      };
    }
    case "anthropic_messages": {
      const anthropic = getAnthropicCompatibleClient(provider);
      return {
        providerId,
        modelType,
        modelId: resolvedModelId,
        providerModelId,
        capabilities,
        model: anthropic(providerModelId),
      };
    }
    case "google_generative_ai": {
      const google = getGoogleGenerativeAIClient(provider);
      return {
        providerId,
        modelType,
        modelId: resolvedModelId,
        providerModelId,
        capabilities,
        model: google.chat(providerModelId),
      };
    }
    default: {
      throw new Error(`Unsupported model type: ${modelType}`);
    }
  }
}

export async function getLanguageModelForProvider(
  providerId: string,
  modelId: unknown
): Promise<ResolvedModel> {
  const provider = getProviderById(providerId);
  return await resolveModelForProvider(providerId, provider, modelId);
}

export async function getLanguageModelForActiveProvider(
  modelId: unknown
): Promise<ResolvedModel> {
  const { provider, activeProviderId } = getActiveProviderConfig();
  return await resolveModelForProvider(activeProviderId, provider, modelId);
}

export function getGatewayProviderForProviderId(providerId: string) {
  const provider = getProviderById(providerId);
  return getVercelGatewayClient(provider);
}

export function getOpenAIProviderForProviderId(providerId: string) {
  const provider = getProviderById(providerId);
  return getOpenAIResponsesClient(provider);
}

export function getAnthropicProviderForProviderId(providerId: string) {
  const provider = getProviderById(providerId);
  return getAnthropicCompatibleClient(provider);
}

export function getGoogleProviderForProviderId(providerId: string) {
  const provider = getProviderById(providerId);
  return getGoogleGenerativeAIClient(provider);
}
