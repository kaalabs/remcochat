import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ModelCapabilities } from "@/lib/models";
import type { ModelType } from "@/server/config";
import { getConfig } from "@/server/config";
import { requireLocalCommandAllowed } from "@/server/local-access";

const execFileAsync = promisify(execFile);

const STABLE_PROVIDER_MODEL_IDS: Record<string, readonly string[]> = {
  e2e_alt: ["gpt-4.1-mini", "gpt-5.2", "gpt-5.2-codex", "gpt-5-nano"],
  e2e_compat: ["gpt-4.1-mini"],
  opencode: ["anthropic/claude-haiku-4.5"],
};

const providerShowCache = new Map<
  string,
  { loadedAt: number; value: ModelsDevProviderShowResponse } | { loadedAt: number; promise: Promise<ModelsDevProviderShowResponse> }
>();

export type ModelsDevProvider = {
  id: string;
  name: string;
  npm?: string;
  api?: string;
  doc?: string;
  env?: string[];
};

export type ModelsDevModel = {
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

export type ModelsDevProviderShowResponse = {
  provider: ModelsDevProvider;
  models: Record<string, ModelsDevModel>;
};

export function modelsdevTimeoutMs(): number {
  const raw = Number(process.env.REMCOCHAT_MODELSDEV_TIMEOUT_MS ?? 15000);
  if (!Number.isFinite(raw)) return 15000;
  return Math.max(1000, Math.min(120_000, Math.floor(raw)));
}

export async function getModelsdevVersion(): Promise<string> {
  requireLocalCommandAllowed({
    cfg: getConfig(),
    command: "modelsdev",
    feature: "modelsdev.version",
  });
  const res = await execFileAsync("modelsdev", ["--version"], {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  return String(res.stdout ?? "").trim();
}

export async function modelsdevProviderShow(
  providerId: string,
  timeoutMs: number
): Promise<ModelsDevProviderShowResponse> {
  requireLocalCommandAllowed({
    cfg: getConfig(),
    command: "modelsdev",
    feature: "modelsdev.provider_show",
  });
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

export async function modelsdevProviderShowCached(
  providerId: string,
  timeoutMs: number,
  opts?: { ttlMs?: number }
): Promise<ModelsDevProviderShowResponse> {
  const ttlMs = Math.max(1_000, Math.min(10 * 60_000, Math.floor(opts?.ttlMs ?? 60_000)));
  const now = Date.now();
  const cached = providerShowCache.get(providerId);
  if (cached) {
    const age = now - cached.loadedAt;
    if (age >= 0 && age <= ttlMs) {
      if ("value" in cached) return cached.value;
      if ("promise" in cached) return cached.promise;
    }
  }

  const promise = modelsdevProviderShow(providerId, timeoutMs).then((value) => {
    providerShowCache.set(providerId, { loadedAt: Date.now(), value });
    return value;
  });
  providerShowCache.set(providerId, { loadedAt: now, promise });
  return promise;
}

export function resetModelsdevProviderShowCache() {
  providerShowCache.clear();
}

export function tryModelTypeFromNpm(npm: string): ModelType | null {
  switch (npm) {
    case "@ai-sdk/gateway":
      return "vercel_ai_gateway";
    case "@ai-sdk/openai":
      return "openai_responses";
    case "@ai-sdk/openai-compatible":
      return "openai_compatible";
    case "@ai-sdk/xai":
      return "xai";
    case "@ai-sdk/anthropic":
      return "anthropic_messages";
    case "@ai-sdk/google":
      return "google_generative_ai";
    default:
      return null;
  }
}

export function tryModelTypeForProviderModel(input: {
  providerId: string;
  modelId: string;
  npm: string;
}): ModelType | null {
  const providerId = String(input.providerId ?? "").trim();
  if (providerId === "e2e_compat") {
    return "openai_compatible";
  }
  if (
    providerId === "opencode" &&
    String(input.modelId ?? "").trim().toLowerCase().startsWith("anthropic/")
  ) {
    return "anthropic_messages";
  }
  return tryModelTypeFromNpm(input.npm);
}

export function isSupportedProviderModel(input: {
  providerId: string;
  modelId: string;
  npm: string;
}): boolean {
  const modelType = tryModelTypeForProviderModel(input);
  if (!modelType) return false;

  const stableModelIds = STABLE_PROVIDER_MODEL_IDS[String(input.providerId ?? "").trim()];
  if (!stableModelIds) return true;

  return stableModelIds.includes(String(input.modelId ?? "").trim());
}

export function requireModelTypeFromNpm(npm: string): ModelType {
  const t = tryModelTypeFromNpm(npm);
  if (!t) {
    throw new Error(`Unsupported model adapter npm: ${npm}`);
  }
  return t;
}

export function requireModelTypeForProviderModel(input: {
  providerId: string;
  modelId: string;
  npm: string;
}): ModelType {
  const t = tryModelTypeForProviderModel(input);
  if (!t) {
    throw new Error(`Unsupported model adapter npm: ${input.npm}`);
  }
  return t;
}

export function descriptionFromModelId(modelId: string, npm: string): string | undefined {
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
    case "@ai-sdk/xai":
      return "xAI";
    case "@ai-sdk/gateway":
      return "Vercel AI Gateway";
    default:
      return undefined;
  }
}

export function normalizeCapabilities(model: ModelsDevModel): ModelCapabilities {
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

export function requireModelsDevProviderNpm(
  providerId: string,
  provider: ModelsDevProvider
): string {
  const npm = String(provider.npm ?? "").trim();
  if (!npm) {
    throw new Error(`modelsdev provider "${providerId}" missing npm adapter`);
  }
  return npm;
}
