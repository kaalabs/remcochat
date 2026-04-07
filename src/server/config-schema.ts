import { z } from "zod";

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
    search_provider: z.enum(["exa", "brave"]).optional(),
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

const LocalAccessSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowed_commands: z.array(z.string().min(1)).optional(),
    allowed_directories: z.array(z.string().min(1)).optional(),
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

const HueGatewaySchema = z
  .object({
    enabled: z.boolean().optional(),
    access: z.enum(["localhost", "lan"]).optional(),
    base_urls: z.array(z.string().min(1)).optional(),
    timeout_ms: z.number().int().min(1_000).max(120_000).optional(),
    auth_header_env: z.string().min(1).optional(),
    bearer_token_env: z.string().min(1).optional(),
    api_key_env: z.string().min(1).optional(),
  })
  .optional();

const OvNlSchema = z
  .object({
    enabled: z.boolean().optional(),
    access: z.enum(["localhost", "lan"]).optional(),
    base_urls: z.array(z.string().min(1)).optional(),
    timeout_ms: z.number().int().min(1_000).max(120_000).optional(),
    subscription_key_env: z.string().min(1).optional(),
    cache_max_ttl_seconds: z.number().int().min(1).max(3_600).optional(),
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

export const RawConfigSchema = z.object({
  version: z.literal(2),
  app: z.object({
    default_provider_id: z.string().min(1),
    router: IntentRouterSchema,
    web_tools: WebToolsSchema,
    skills: SkillsSchema,
    local_access: LocalAccessSchema,
    reasoning: ReasoningSchema,
    bash_tools: BashToolsSchema,
    hue_gateway: HueGatewaySchema,
    ov_nl: OvNlSchema,
    attachments: AttachmentsSchema,
  }),
  providers: z.record(z.string(), ProviderSchema),
});

export type RawRemcoChatConfig = z.infer<typeof RawConfigSchema>;
