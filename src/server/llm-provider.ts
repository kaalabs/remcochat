import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ModelType, RemcoChatProvider } from "@/server/config";
import { getConfig } from "@/server/config";
import { getActiveProviderConfig } from "@/server/model-registry";

type ResolvedModel = {
  providerId: string;
  modelType: ModelType;
  modelId: string;
  providerModelId: string;
  capabilities: RemcoChatProvider["models"][number]["capabilities"];
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

function resolveProviderModelId(provider: RemcoChatProvider, modelId: unknown) {
  const resolvedModelId =
    typeof modelId === "string" &&
    provider.models.some((m) => m.id === modelId)
      ? modelId
      : provider.defaultModelId;
  const model =
    provider.models.find((m) => m.id === resolvedModelId) ??
    provider.models.find((m) => m.id === provider.defaultModelId);
  if (!model) {
    throw new Error(`Provider "${provider.id}" has no models configured.`);
  }

  return {
    resolvedModelId,
    providerModelId: model.providerModelId,
    modelType: model.type,
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

function resolveModelForProvider(
  providerId: string,
  provider: RemcoChatProvider,
  modelId: unknown
): ResolvedModel {
  const { resolvedModelId, providerModelId, modelType, capabilities } =
    resolveProviderModelId(provider, modelId);
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
  }
}

export function getLanguageModelForProvider(
  providerId: string,
  modelId: unknown
): ResolvedModel {
  const provider = getProviderById(providerId);
  return resolveModelForProvider(providerId, provider, modelId);
}

export function getLanguageModelForActiveProvider(modelId: unknown): ResolvedModel {
  const { provider, activeProviderId } = getActiveProviderConfig();
  return resolveModelForProvider(activeProviderId, provider, modelId);
}
