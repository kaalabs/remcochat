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

const RawConfigSchema = z.object({
  version: z.literal(1),
  app: z.object({
    default_provider_id: z.string().min(1),
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

  return {
    version: 1,
    defaultProviderId,
    providers,
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
