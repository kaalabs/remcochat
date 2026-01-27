import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import TOML from "@iarna/toml";

export const MODEL_TYPES = [
  "vercel_ai_gateway",
  "openai_responses",
  "openai_compatible",
  "anthropic_messages",
  "google_generative_ai",
] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

const ProviderSchema = z.object({
  name: z.string().min(1),
  default_model_id: z.string().min(1),
  base_url: z.string().min(1),
  api_key_env: z.string().min(1),
  modelsdev_provider_id: z.string().min(1).optional(),
  allowed_model_ids: z.array(z.string().min(1)).min(1),
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

const WebToolsSchema = z
  .object({
    enabled: z.boolean().optional(),
    max_results: z.number().int().min(1).max(20).optional(),
    recency: z.enum(["day", "week", "month", "year"]).optional(),
    allowed_domains: z.array(z.string().min(1)).optional(),
    blocked_domains: z.array(z.string().min(1)).optional(),
  })
  .optional();

const SkillsSchema = z
  .object({
    enabled: z.boolean().optional(),
    directories: z.array(z.string().min(1)).optional(),
    max_skills: z.number().int().min(1).max(10_000).optional(),
    max_skill_md_bytes: z.number().int().min(1_000).max(50_000_000).optional(),
    max_resource_bytes: z.number().int().min(1_000).max(200_000_000).optional(),
  })
  .optional();

const ReasoningSchema = z
  .object({
    enabled: z.boolean().optional(),
    effort: z.enum(["minimal", "low", "medium", "high"]).optional(),
    expose_to_client: z.boolean().optional(),
    openai_summary: z.string().optional(),
    anthropic_budget_tokens: z.number().int().min(0).max(200_000).optional(),
    google_thinking_budget: z.number().int().min(0).max(200_000).optional(),
  })
  .optional();

const BashToolsSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.enum(["vercel", "docker"]).optional(),
    access: z.enum(["localhost", "lan"]).optional(),
    project_root: z.string().optional(),
    max_stdout_chars: z.number().int().min(200).max(200_000).optional(),
    max_stderr_chars: z.number().int().min(200).max(200_000).optional(),
    timeout_ms: z.number().int().min(1_000).max(5 * 60_000).optional(),
    max_concurrent_sandboxes: z.number().int().min(1).max(10).optional(),
    idle_ttl_ms: z.number().int().min(10_000).max(6 * 60 * 60_000).optional(),
    docker: z
      .object({
        orchestrator_url: z.string().optional(),
        admin_token_env: z.string().optional(),
        network_mode: z.enum(["default", "none"]).optional(),
        memory_mb: z.number().int().min(256).max(16_384).optional(),
      })
      .optional(),
    sandbox: z
      .object({
        runtime: z.string().min(1).optional(),
        ports: z
          .array(z.number().int().min(1).max(65535))
          .max(4)
          .optional(),
        vcpus: z.number().int().min(1).max(8).optional(),
        timeout_ms: z.number().int().min(30_000).max(5 * 60 * 60_000).optional(),
      })
      .optional(),
    seed: z
      .object({
        mode: z.enum(["upload", "git"]).optional(),
        git_url: z.string().optional(),
        git_revision: z.string().optional(),
        upload_include: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const AttachmentsSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowed_media_types: z.array(z.string().min(1)).optional(),
    max_files_per_message: z.number().int().min(1).max(20).optional(),
    max_file_size_bytes: z.number().int().min(1).max(50_000_000).optional(),
    max_total_size_bytes: z.number().int().min(1).max(200_000_000).optional(),
    max_extracted_text_chars: z.number().int().min(200).max(2_000_000).optional(),
    temporary_ttl_ms: z.number().int().min(10_000).max(30 * 24 * 60 * 60_000).optional(),
    sandbox: z
      .object({
        runtime: z.string().min(1).optional(),
        vcpus: z.number().int().min(1).max(8).optional(),
        timeout_ms: z.number().int().min(30_000).max(5 * 60 * 60_000).optional(),
      })
      .optional(),
    processing: z
      .object({
        timeout_ms: z.number().int().min(1_000).max(10 * 60_000).optional(),
        max_stdout_chars: z.number().int().min(200).max(200_000).optional(),
        max_stderr_chars: z.number().int().min(200).max(200_000).optional(),
      })
      .optional(),
  })
  .optional();

const RawConfigSchema = z.object({
  version: z.literal(2),
  app: z.object({
    default_provider_id: z.string().min(1),
    router: IntentRouterSchema,
    web_tools: WebToolsSchema,
    skills: SkillsSchema,
    reasoning: ReasoningSchema,
    bash_tools: BashToolsSchema,
    attachments: AttachmentsSchema,
  }),
  providers: z.record(z.string(), ProviderSchema),
});

export type RemcoChatProvider = {
  id: string;
  name: string;
  defaultModelId: string;
  modelsdevProviderId: string;
  allowedModelIds: string[];
  baseUrl: string;
  apiKeyEnv: string;
};

export type RemcoChatConfig = {
  version: 2;
  defaultProviderId: string;
  providers: RemcoChatProvider[];
  skills: {
    enabled: boolean;
    directories: string[];
    maxSkills: number;
    maxSkillMdBytes: number;
    maxResourceBytes: number;
  } | null;
  intentRouter: {
    enabled: boolean;
    providerId: string;
    modelId: string;
    minConfidence: number;
    maxInputChars: number;
  } | null;
  webTools: {
    enabled: boolean;
    maxResults: number;
    recency: "day" | "week" | "month" | "year" | null;
    allowedDomains: string[];
    blockedDomains: string[];
  } | null;
  reasoning: {
    enabled: boolean;
    effort: "minimal" | "low" | "medium" | "high";
    exposeToClient: boolean;
    openaiSummary: string | null;
    anthropicBudgetTokens: number | null;
    googleThinkingBudget: number | null;
  };
  bashTools: {
    enabled: boolean;
    provider: "vercel" | "docker";
    access: "localhost" | "lan";
    projectRoot: string | null;
    maxStdoutChars: number;
    maxStderrChars: number;
    timeoutMs: number;
    maxConcurrentSandboxes: number;
    idleTtlMs: number;
    docker: {
      orchestratorUrl: string;
      adminTokenEnv: string;
      networkMode: "default" | "none";
      memoryMb: number;
    } | null;
    sandbox: {
      runtime: string;
      ports: number[];
      vcpus: number;
      timeoutMs: number;
    };
    seed: {
      mode: "upload" | "git";
      gitUrl: string | null;
      gitRevision: string | null;
      uploadInclude: string;
    };
  } | null;
  attachments: {
    enabled: boolean;
    allowedMediaTypes: string[];
    maxFilesPerMessage: number;
    maxFileSizeBytes: number;
    maxTotalSizeBytes: number;
    maxExtractedTextChars: number;
    temporaryTtlMs: number;
    sandbox: {
      runtime: string;
      vcpus: number;
      timeoutMs: number;
    };
    processing: {
      timeoutMs: number;
      maxStdoutChars: number;
      maxStderrChars: number;
    };
  };
};

let cachedConfig: RemcoChatConfig | null = null;

function normalizeConfig(raw: z.infer<typeof RawConfigSchema>): RemcoChatConfig {
  const providers: RemcoChatProvider[] = [];
  for (const [id, p] of Object.entries(raw.providers)) {
    providers.push({
      id,
      name: p.name,
      defaultModelId: p.default_model_id,
      modelsdevProviderId: p.modelsdev_provider_id ?? id,
      allowedModelIds: Array.from(new Set(p.allowed_model_ids)),
      baseUrl: p.base_url,
      apiKeyEnv: p.api_key_env,
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
    const modelIds = new Set(provider.allowedModelIds);
    if (!modelIds.has(provider.defaultModelId)) {
      throw new Error(
        `config.toml: providers.${provider.id}.default_model_id "${provider.defaultModelId}" is not present in providers.${provider.id}.allowed_model_ids`
      );
    }
  }

  let skills: RemcoChatConfig["skills"] = null;
  const rawSkills = raw.app.skills ?? {};
  const skillsEnabled = Boolean(rawSkills.enabled ?? false);
  if (skillsEnabled) {
    const repoBaseDir = process.cwd();
    const homeDir = os.homedir();

    const defaultDirs = [
      "./.skills",
      "./.github/skills",
      "./.claude/skills",
      path.join(homeDir, ".remcochat", "skills"),
    ];

    const inputDirsRaw = Array.isArray(rawSkills.directories)
      ? rawSkills.directories.map((d) => String(d).trim()).filter(Boolean)
      : [];
    const inputDirs = inputDirsRaw.length > 0 ? inputDirsRaw : defaultDirs;

    const resolveDir = (dir: string) => {
      const trimmed = String(dir ?? "").trim();
      if (!trimmed) return "";
      if (trimmed === "~") return homeDir;
      if (trimmed.startsWith("~/")) return path.join(homeDir, trimmed.slice(2));
      if (path.isAbsolute(trimmed)) return trimmed;
      return path.resolve(repoBaseDir, trimmed);
    };

    const seen = new Set<string>();
    const directories: string[] = [];
    for (const entry of inputDirs) {
      const resolved = resolveDir(entry);
      if (!resolved) continue;
      const normalized = resolved.replace(/\/+$/, "");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      directories.push(normalized);
    }

    const maxSkills = Math.min(
      10_000,
      Math.max(1, Math.floor(Number(rawSkills.max_skills ?? 200)))
    );
    const maxSkillMdBytes = Math.min(
      50_000_000,
      Math.max(1_000, Math.floor(Number(rawSkills.max_skill_md_bytes ?? 200_000)))
    );
    const maxResourceBytes = Math.min(
      200_000_000,
      Math.max(1_000, Math.floor(Number(rawSkills.max_resource_bytes ?? 2_000_000)))
    );

    skills = {
      enabled: true,
      directories,
      maxSkills,
      maxSkillMdBytes,
      maxResourceBytes,
    };
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
    if (!provider.allowedModelIds.includes(modelId)) {
      throw new Error(
        `config.toml: app.router.model_id "${modelId}" is not present in providers.${providerId}.allowed_model_ids`
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

  let webTools: RemcoChatConfig["webTools"] = null;
  const rawWebTools = raw.app.web_tools ?? {};
  const webEnabled = Boolean(rawWebTools.enabled ?? false);
  if (webEnabled) {
    const maxResults = Math.min(
      20,
      Math.max(1, Math.floor(Number(rawWebTools.max_results ?? 8)))
    );
    const recency = rawWebTools.recency ?? null;
    const allowedDomains = Array.isArray(rawWebTools.allowed_domains)
      ? rawWebTools.allowed_domains.map((d) => String(d).trim()).filter(Boolean)
      : [];
    const blockedDomains = Array.isArray(rawWebTools.blocked_domains)
      ? rawWebTools.blocked_domains.map((d) => String(d).trim()).filter(Boolean)
      : [];

    if (allowedDomains.length > 0 && blockedDomains.length > 0) {
      throw new Error(
        "config.toml: app.web_tools.allowed_domains and app.web_tools.blocked_domains cannot both be set"
      );
    }

    webTools = {
      enabled: true,
      maxResults,
      recency,
      allowedDomains,
      blockedDomains,
    };
  }

  const rawReasoning = raw.app.reasoning ?? {};
  const reasoningEnabled = Boolean(rawReasoning.enabled ?? true);
  const effort = rawReasoning.effort ?? "medium";
  const exposeToClient = Boolean(rawReasoning.expose_to_client ?? false);
  const openaiSummaryRaw = String(rawReasoning.openai_summary ?? "").trim();
  const openaiSummary = openaiSummaryRaw ? openaiSummaryRaw : null;
  const anthropicBudgetRaw = rawReasoning.anthropic_budget_tokens;
  const anthropicBudgetTokens =
    typeof anthropicBudgetRaw === "number" && Number.isFinite(anthropicBudgetRaw)
      ? Math.max(0, Math.floor(anthropicBudgetRaw)) || null
      : null;
  const googleBudgetRaw = rawReasoning.google_thinking_budget;
  const googleThinkingBudget =
    typeof googleBudgetRaw === "number" && Number.isFinite(googleBudgetRaw)
      ? Math.max(0, Math.floor(googleBudgetRaw)) || null
      : null;

  let bashTools: RemcoChatConfig["bashTools"] = null;
  const rawBashTools = raw.app.bash_tools ?? {};
  const bashEnabled = Boolean(rawBashTools.enabled ?? false);
  if (bashEnabled) {
    const provider = rawBashTools.provider ?? "vercel";
    const access = rawBashTools.access ?? "localhost";
    const projectRootRaw = String(rawBashTools.project_root ?? "").trim();
    const projectRoot = projectRootRaw ? projectRootRaw : null;
    if (projectRoot && !path.isAbsolute(projectRoot)) {
      throw new Error(
        "config.toml: app.bash_tools.project_root must be an absolute path"
      );
    }

    const maxStdoutChars = Math.min(
      200_000,
      Math.max(200, Math.floor(Number(rawBashTools.max_stdout_chars ?? 12_000)))
    );
    const maxStderrChars = Math.min(
      200_000,
      Math.max(200, Math.floor(Number(rawBashTools.max_stderr_chars ?? 12_000)))
    );
    const timeoutMs = Math.min(
      5 * 60_000,
      Math.max(1_000, Math.floor(Number(rawBashTools.timeout_ms ?? 30_000)))
    );
    const maxConcurrentSandboxes = Math.min(
      10,
      Math.max(
        1,
        Math.floor(Number(rawBashTools.max_concurrent_sandboxes ?? 2))
      )
    );
    const idleTtlMs = Math.min(
      6 * 60 * 60_000,
      Math.max(10_000, Math.floor(Number(rawBashTools.idle_ttl_ms ?? 900_000)))
    );

    let docker: NonNullable<RemcoChatConfig["bashTools"]>["docker"] = null;
    if (provider === "docker") {
      const rawDocker = rawBashTools.docker ?? {};
      const orchestratorUrl = String(rawDocker.orchestrator_url ?? "").trim();
      if (!orchestratorUrl) {
        throw new Error(
          "config.toml: app.bash_tools.docker.orchestrator_url is required when provider = \"docker\""
        );
      }
      let url: URL;
      try {
        url = new URL(orchestratorUrl);
      } catch (err) {
        throw new Error(
          `config.toml: app.bash_tools.docker.orchestrator_url is invalid (${err instanceof Error ? err.message : "unknown error"})`
        );
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(
          "config.toml: app.bash_tools.docker.orchestrator_url must be http(s)"
        );
      }

      const adminTokenEnv =
        String(rawDocker.admin_token_env ?? "REMCOCHAT_ADMIN_TOKEN").trim() ||
        "REMCOCHAT_ADMIN_TOKEN";
      const networkMode = rawDocker.network_mode ?? "default";
      const memoryMb = Math.min(
        16_384,
        Math.max(256, Math.floor(Number(rawDocker.memory_mb ?? 2048)))
      );

      docker = {
        orchestratorUrl: url.toString().replace(/\/+$/, ""),
        adminTokenEnv,
        networkMode,
        memoryMb,
      };
    } else if (provider !== "vercel") {
      throw new Error(
        "config.toml: app.bash_tools.provider must be \"vercel\" or \"docker\""
      );
    }

    const sandboxRuntimeDefault = provider === "docker" ? "node24" : "node22";
    const sandboxRuntime = String(
      rawBashTools.sandbox?.runtime ?? sandboxRuntimeDefault
    ).trim();
    const sandboxPortsRaw = rawBashTools.sandbox?.ports;
    const sandboxPorts = Array.isArray(sandboxPortsRaw)
      ? Array.from(
          new Set(
            sandboxPortsRaw
              .map((p) => Math.floor(Number(p)))
              .filter((p) => Number.isFinite(p) && p >= 1 && p <= 65535)
          )
        ).slice(0, 4)
      : [3000];
    const sandboxVcpus = Math.min(
      8,
      Math.max(1, Math.floor(Number(rawBashTools.sandbox?.vcpus ?? 2)))
    );
    const sandboxTimeoutMs = Math.min(
      5 * 60 * 60_000,
      Math.max(
        30_000,
        Math.floor(Number(rawBashTools.sandbox?.timeout_ms ?? 900_000))
      )
    );

    if (provider === "docker") {
      if (sandboxRuntime !== "node24" && sandboxRuntime !== "python3.13") {
        throw new Error(
          "config.toml: app.bash_tools.sandbox.runtime must be \"node24\" or \"python3.13\" when provider = \"docker\""
        );
      }
    }

    const seedMode = rawBashTools.seed?.mode ?? "git";
    const gitUrlRaw = String(rawBashTools.seed?.git_url ?? "").trim();
    const gitUrl = gitUrlRaw ? gitUrlRaw : null;
    const gitRevisionRaw = String(rawBashTools.seed?.git_revision ?? "").trim();
    const gitRevision = gitRevisionRaw ? gitRevisionRaw : null;
    const uploadInclude = String(rawBashTools.seed?.upload_include ?? "**/*").trim() || "**/*";

    if (seedMode === "git") {
      if (!gitUrl) {
        throw new Error(
          "config.toml: app.bash_tools.seed.git_url is required when seed.mode = \"git\""
        );
      }
    } else if (seedMode === "upload") {
      if (!projectRoot) {
        throw new Error(
          "config.toml: app.bash_tools.project_root is required when seed.mode = \"upload\""
        );
      }
    }

    bashTools = {
      enabled: true,
      provider,
      access,
      projectRoot,
      maxStdoutChars,
      maxStderrChars,
      timeoutMs,
      maxConcurrentSandboxes,
      idleTtlMs,
      docker,
      sandbox: {
        runtime: sandboxRuntime,
        ports: sandboxPorts,
        vcpus: sandboxVcpus,
        timeoutMs: sandboxTimeoutMs,
      },
      seed: {
        mode: seedMode,
        gitUrl,
        gitRevision,
        uploadInclude,
      },
    };
  }

  const defaultAllowedMediaTypes = [
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/pdf",
  ];

  const rawAttachments = raw.app.attachments ?? {};
  const attachmentsEnabled = Boolean(rawAttachments.enabled ?? true);
  const allowedMediaTypes = Array.from(
    new Set(
      (Array.isArray(rawAttachments.allowed_media_types)
        ? rawAttachments.allowed_media_types
        : defaultAllowedMediaTypes
      )
        .map((t) => String(t).trim())
        .filter(Boolean)
    )
  );
  const maxFilesPerMessage = Math.min(
    20,
    Math.max(1, Math.floor(Number(rawAttachments.max_files_per_message ?? 3)))
  );
  const maxFileSizeBytes = Math.min(
    50_000_000,
    Math.max(1, Math.floor(Number(rawAttachments.max_file_size_bytes ?? 2_000_000)))
  );
  const maxTotalSizeBytes = Math.min(
    200_000_000,
    Math.max(
      maxFileSizeBytes,
      Math.floor(Number(rawAttachments.max_total_size_bytes ?? 5_000_000))
    )
  );
  const maxExtractedTextChars = Math.min(
    2_000_000,
    Math.max(
      200,
      Math.floor(Number(rawAttachments.max_extracted_text_chars ?? 120_000))
    )
  );
  const temporaryTtlMs = Math.min(
    30 * 24 * 60 * 60_000,
    Math.max(10_000, Math.floor(Number(rawAttachments.temporary_ttl_ms ?? 6 * 60 * 60_000)))
  );

  const attachmentsSandbox = rawAttachments.sandbox ?? {};
  const attachmentsSandboxRuntime = String(attachmentsSandbox.runtime ?? "node22").trim() || "node22";
  const attachmentsSandboxVcpus = Math.min(
    8,
    Math.max(1, Math.floor(Number(attachmentsSandbox.vcpus ?? 2)))
  );
  const attachmentsSandboxTimeoutMs = Math.min(
    5 * 60 * 60_000,
    Math.max(30_000, Math.floor(Number(attachmentsSandbox.timeout_ms ?? 900_000)))
  );

  const attachmentsProcessing = rawAttachments.processing ?? {};
  const attachmentsProcessingTimeoutMs = Math.min(
    10 * 60_000,
    Math.max(1_000, Math.floor(Number(attachmentsProcessing.timeout_ms ?? 30_000)))
  );
  const attachmentsProcessingMaxStdoutChars = Math.min(
    200_000,
    Math.max(200, Math.floor(Number(attachmentsProcessing.max_stdout_chars ?? 200_000)))
  );
  const attachmentsProcessingMaxStderrChars = Math.min(
    200_000,
    Math.max(200, Math.floor(Number(attachmentsProcessing.max_stderr_chars ?? 20_000)))
  );

  return {
    version: 2,
    defaultProviderId,
    providers,
    skills,
    intentRouter,
    webTools,
    reasoning: {
      enabled: reasoningEnabled,
      effort,
      exposeToClient,
      openaiSummary,
      anthropicBudgetTokens,
      googleThinkingBudget,
    },
    bashTools,
    attachments: {
      enabled: attachmentsEnabled,
      allowedMediaTypes,
      maxFilesPerMessage,
      maxFileSizeBytes,
      maxTotalSizeBytes,
      maxExtractedTextChars,
      temporaryTtlMs,
      sandbox: {
        runtime: attachmentsSandboxRuntime,
        vcpus: attachmentsSandboxVcpus,
        timeoutMs: attachmentsSandboxTimeoutMs,
      },
      processing: {
        timeoutMs: attachmentsProcessingTimeoutMs,
        maxStdoutChars: attachmentsProcessingMaxStdoutChars,
        maxStderrChars: attachmentsProcessingMaxStderrChars,
      },
    },
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
