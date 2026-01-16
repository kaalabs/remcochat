import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import TOML from "@iarna/toml";

const MODEL_TYPES = [
  "vercel_ai_gateway",
  "openai_responses",
  "openai_compatible",
  "anthropic_messages",
  "google_generative_ai",
] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

const ModelCapabilitiesSchema = z.object({
  tools: z.boolean(),
  temperature: z.boolean(),
  attachments: z.boolean(),
  structured_output: z.boolean(),
});

const ModelSchema = z.object({
  type: z.enum(MODEL_TYPES),
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  provider_model_id: z.string().min(1).optional(),
  capabilities: ModelCapabilitiesSchema,
});

const ProviderSchema = z.object({
  name: z.string().min(1),
  default_model_id: z.string().min(1),
  base_url: z.string().min(1),
  api_key_env: z.string().min(1),
  models: z.array(ModelSchema).min(1),
});

const IntentRouterSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider_id: z.string().min(1).optional(),
    model_id: z.string().min(1).optional(),
    min_confidence: z.number().min(0).max(1).optional(),
    max_input_chars: z.number().int().min(20).max(4000).optional(),
  })
  .optional();

const RawConfigSchema = z.object({
  version: z.literal(1),
  app: z.object({
    default_provider_id: z.string().min(1),
    router: IntentRouterSchema,
  }),
  providers: z.record(z.string(), ProviderSchema),
});

export type RemcoChatProviderModel = {
  type: ModelType;
  id: string;
  label: string;
  description?: string;
  providerModelId: string;
  capabilities: {
    tools: boolean;
    temperature: boolean;
    attachments: boolean;
    structuredOutput: boolean;
  };
};

export type RemcoChatProvider = {
  id: string;
  name: string;
  defaultModelId: string;
  models: RemcoChatProviderModel[];
  baseUrl: string;
  apiKeyEnv: string;
};

export type RemcoChatConfig = {
  version: 1;
  defaultProviderId: string;
  providers: RemcoChatProvider[];
  intentRouter: {
    enabled: boolean;
    providerId: string;
    modelId: string;
    minConfidence: number;
    maxInputChars: number;
  } | null;
};

let cachedConfig: RemcoChatConfig | null = null;

function normalizeConfig(raw: z.infer<typeof RawConfigSchema>): RemcoChatConfig {
  const providers: RemcoChatProvider[] = [];
  for (const [id, p] of Object.entries(raw.providers)) {
    providers.push({
      id,
      name: p.name,
      defaultModelId: p.default_model_id,
      baseUrl: p.base_url,
      apiKeyEnv: p.api_key_env,
      models: p.models.map((m) => ({
        type: m.type,
        id: m.id,
        label: m.label,
        description: m.description,
        providerModelId: m.provider_model_id ?? m.id,
        capabilities: {
          tools: m.capabilities.tools,
          temperature: m.capabilities.temperature,
          attachments: m.capabilities.attachments,
          structuredOutput: m.capabilities.structured_output,
        },
      })),
    });
  }

  if (providers.length === 0) {
    throw new Error(
      "config.toml: at least one provider must be configured under [providers.<id>]"
    );
  }

  const providerIds = new Set(providers.map((p) => p.id));
  const defaultProviderId = raw.app.default_provider_id;
  if (!providerIds.has(defaultProviderId)) {
    throw new Error(
      `config.toml: app.default_provider_id "${defaultProviderId}" is not present in providers`
    );
  }

  for (const provider of providers) {
    const modelIds = new Set(provider.models.map((m) => m.id));
    if (!modelIds.has(provider.defaultModelId)) {
      throw new Error(
        `config.toml: providers.${provider.id}.default_model_id "${provider.defaultModelId}" is not present in providers.${provider.id}.models`
      );
    }
  }

  let intentRouter: RemcoChatConfig["intentRouter"] = null;
  const router = raw.app.router ?? {};
  const routerEnabled = Boolean(router.enabled ?? false);
  if (routerEnabled) {
    const providerId = String(router.provider_id ?? "").trim();
    if (!providerId) {
      throw new Error(
        "config.toml: app.router.provider_id is required when router is enabled"
      );
    }
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) {
      throw new Error(
        `config.toml: app.router.provider_id "${providerId}" is not present in providers`
      );
    }
    const modelId = String(router.model_id ?? "").trim();
    if (!modelId) {
      throw new Error(
        "config.toml: app.router.model_id is required when router is enabled"
      );
    }
    if (!provider.models.some((m) => m.id === modelId)) {
      throw new Error(
        `config.toml: app.router.model_id "${modelId}" is not present in providers.${providerId}.models`
      );
    }
    const minConfidence = Math.min(
      1,
      Math.max(0, Number(router.min_confidence ?? 0.7))
    );
    const maxInputChars = Math.min(
      4000,
      Math.max(20, Math.floor(Number(router.max_input_chars ?? 600)))
    );
    intentRouter = {
      enabled: true,
      providerId,
      modelId,
      minConfidence,
      maxInputChars,
    };
  }

  return {
    version: 1,
    defaultProviderId,
    providers,
    intentRouter,
  };
}

function configPath() {
  const fromEnv = process.env.REMCOCHAT_CONFIG_PATH;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return path.join(process.cwd(), "config.toml");
}

function tomlToPlainObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => tomlToPlainObject(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = tomlToPlainObject(inner);
    }
    return out;
  }
  return value;
}

export function getConfig(): RemcoChatConfig {
  if (cachedConfig) return cachedConfig;

  const filePath = configPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(
      [
        `Missing RemcoChat config file: ${filePath}`,
        "",
        "Create it by copying `config.toml.example` to `config.toml`.",
        "Or set `REMCOCHAT_CONFIG_PATH` to point at your config file.",
      ].join("\n")
    );
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`RemcoChat config path is not a file: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  const parsed = TOML.parse(content);
  const raw = RawConfigSchema.parse(tomlToPlainObject(parsed));
  cachedConfig = normalizeConfig(raw);
  return cachedConfig;
}

export function _resetConfigCacheForTests() {
  cachedConfig = null;
}
