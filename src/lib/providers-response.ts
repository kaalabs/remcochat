import type { ModelCapabilities, ModelOption } from "@/lib/models";

export type ProvidersResponse = {
  defaultProviderId: string;
  activeProviderId: string;
  webToolsEnabled: boolean;
  providers: Array<{
    id: string;
    name: string;
    defaultModelId: string;
    models: ModelOption[];
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelCapabilities(value: unknown): ModelCapabilities | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) return undefined;
  if (
    typeof value.tools !== "boolean" ||
    typeof value.reasoning !== "boolean" ||
    typeof value.temperature !== "boolean" ||
    typeof value.attachments !== "boolean" ||
    typeof value.structuredOutput !== "boolean"
  ) {
    return undefined;
  }

  return {
    tools: value.tools,
    reasoning: value.reasoning,
    temperature: value.temperature,
    attachments: value.attachments,
    structuredOutput: value.structuredOutput,
  };
}

function parseModelOption(value: unknown): ModelOption | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.label !== "string") return null;

  const model: ModelOption = {
    id: value.id,
    label: value.label,
  };

  if (typeof value.description === "string") {
    model.description = value.description;
  }
  if (typeof value.type === "string") {
    model.type = value.type;
  }
  if (typeof value.contextWindow === "number" && Number.isFinite(value.contextWindow)) {
    model.contextWindow = value.contextWindow;
  }

  const capabilities = parseModelCapabilities(value.capabilities);
  if (capabilities) {
    model.capabilities = capabilities;
  }

  return model;
}

function parseProvider(value: unknown): ProvidersResponse["providers"][number] | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.defaultModelId !== "string" ||
    !Array.isArray(value.models)
  ) {
    return null;
  }

  const models = value.models
    .map((model) => parseModelOption(model))
    .filter((model): model is ModelOption => model != null);

  if (models.length !== value.models.length) return null;

  return {
    id: value.id,
    name: value.name,
    defaultModelId: value.defaultModelId,
    models,
  };
}

export function parseProvidersResponse(value: unknown): ProvidersResponse | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.defaultProviderId !== "string" ||
    typeof value.activeProviderId !== "string" ||
    typeof value.webToolsEnabled !== "boolean" ||
    !Array.isArray(value.providers)
  ) {
    return null;
  }

  const providers = value.providers
    .map((provider) => parseProvider(provider))
    .filter((provider): provider is ProvidersResponse["providers"][number] => provider != null);

  if (providers.length !== value.providers.length) return null;

  return {
    defaultProviderId: value.defaultProviderId,
    activeProviderId: value.activeProviderId,
    webToolsEnabled: value.webToolsEnabled,
    providers,
  };
}

export function parseErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.error !== "string") return null;
  const trimmed = value.error.trim();
  return trimmed || null;
}
