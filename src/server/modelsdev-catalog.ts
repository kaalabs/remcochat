import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ModelCapabilities } from "@/lib/models";
import type { ModelType, RemcoChatProvider } from "@/server/config";
import { MODEL_TYPES, getConfig } from "@/server/config";

const execFileAsync = promisify(execFile);

type ModelsDevProvider = {
  id: string;
  name: string;
  npm?: string;
  api?: string;
  doc?: string;
  env?: string[];
};

type ModelsDevModel = {
  id: string;
  name: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  limit?: {
    context?: number;
    output?: number;
    input?: number;
  };
  provider?: {
    npm?: string;
  };
  interleaved?: {
    field?: string;
  };
  status?: string;
};

type ModelsDevProviderShowResponse = {
  provider: ModelsDevProvider;
  models: Record<string, ModelsDevModel>;
};

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

function modelsdevTimeoutMs(): number {
  const raw = Number(process.env.REMCOCHAT_MODELSDEV_TIMEOUT_MS ?? 15000);
  if (!Number.isFinite(raw)) return 15000;
  return Math.max(1000, Math.min(120_000, Math.floor(raw)));
}

async function getModelsdevVersion(): Promise<string> {
  const res = await execFileAsync("modelsdev", ["--version"], {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  return String(res.stdout ?? "").trim();
}

async function modelsdevProviderShow(
  providerId: string,
  timeoutMs: number
): Promise<ModelsDevProviderShowResponse> {
  const res = await execFileAsync(
    "modelsdev",
    ["providers", "show", providerId, "-d", "--json", "--timeout", String(timeoutMs)],
    { timeout: timeoutMs + 5000, maxBuffer: 10 * 1024 * 1024 }
  );
  const raw = String(res.stdout ?? "").trim();
  if (!raw) {
    throw new Error(`modelsdev providers show ${providerId}: empty output`);
  }
  try {
    return JSON.parse(raw) as ModelsDevProviderShowResponse;
  } catch (err) {
    throw new Error(
      `modelsdev providers show ${providerId}: invalid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function modelTypeFromNpm(npm: string): ModelType {
  switch (npm) {
    case "@ai-sdk/gateway":
      return "vercel_ai_gateway";
    case "@ai-sdk/openai":
      return "openai_responses";
    case "@ai-sdk/openai-compatible":
      return "openai_compatible";
    case "@ai-sdk/anthropic":
      return "anthropic_messages";
    case "@ai-sdk/google":
      return "google_generative_ai";
    default:
      throw new Error(`Unsupported model adapter npm: ${npm}`);
  }
}

function descriptionFromModelId(modelId: string, npm: string): string | undefined {
  const prefix = modelId.includes("/") ? modelId.split("/")[0] : "";
  if (prefix) {
    switch (prefix.toLowerCase()) {
      case "openai":
        return "OpenAI";
      case "anthropic":
        return "Anthropic";
      case "google":
        return "Google";
      case "perplexity":
        return "Perplexity";
      default:
        return prefix;
    }
  }

  switch (npm) {
    case "@ai-sdk/openai":
      return "OpenAI";
    case "@ai-sdk/anthropic":
      return "Anthropic";
    case "@ai-sdk/google":
      return "Google";
    case "@ai-sdk/openai-compatible":
      return "OpenAI Compatible";
    case "@ai-sdk/gateway":
      return "Vercel AI Gateway";
    default:
      return undefined;
  }
}

function normalizeCapabilities(model: ModelsDevModel): ModelCapabilities {
  const modelId = String(model.id ?? "").trim();
  const isOpenAIModel = modelId.toLowerCase().startsWith("openai/");
  const reasoning = Boolean(model.reasoning ?? false);
  const temperatureFlag = Boolean(model.temperature ?? false);

  // The AI SDK does not support `temperature` for OpenAI reasoning models (they use other controls).
  // models.dev currently marks some OpenAI reasoning models as temperature-capable, so we normalize
  // to prevent passing unsupported parameters (and avoid runtime warnings).
  const temperature = isOpenAIModel && reasoning ? false : temperatureFlag;

  return {
    tools: Boolean(model.tool_call ?? false),
    reasoning,
    temperature,
    attachments: Boolean(model.attachment ?? false),
    structuredOutput: Boolean(model.structured_output ?? false),
  };
}

function requireModelsDevProviderNpm(
  providerId: string,
  provider: ModelsDevProvider
): string {
  const npm = String(provider.npm ?? "").trim();
  if (!npm) {
    throw new Error(`modelsdev provider "${providerId}" missing npm adapter`);
  }
  return npm;
}

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
    const modelType = modelTypeFromNpm(npm);
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
