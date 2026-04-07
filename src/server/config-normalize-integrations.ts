import path from "node:path";
import type { RemcoChatConfig } from "./config-types";
import type {
  RawAttachmentsConfig,
  RawBashToolsConfig,
  RawHueGatewayConfig,
  RawOvNlConfig,
} from "./config-normalize-types";
import { clampInt, normalizeServiceBaseUrls } from "./config-normalize-shared";

export function normalizeBashTools(
  rawBashTools: RawBashToolsConfig | undefined
): RemcoChatConfig["bashTools"] {
  const bashTools = rawBashTools ?? {};
  if (!Boolean(bashTools.enabled ?? false)) {
    return null;
  }

  const provider = bashTools.provider ?? "vercel";
  const access = bashTools.access ?? "localhost";
  const projectRootRaw = String(bashTools.project_root ?? "").trim();
  const projectRoot = projectRootRaw ? projectRootRaw : null;
  if (projectRoot && !path.isAbsolute(projectRoot)) {
    throw new Error("config.toml: app.bash_tools.project_root must be an absolute path");
  }

  let docker: NonNullable<RemcoChatConfig["bashTools"]>["docker"] = null;
  if (provider === "docker") {
    const rawDocker = bashTools.docker ?? {};
    const orchestratorUrl = String(rawDocker.orchestrator_url ?? "").trim();
    if (!orchestratorUrl) {
      throw new Error(
        'config.toml: app.bash_tools.docker.orchestrator_url is required when provider = "docker"'
      );
    }

    let url: URL;
    try {
      url = new URL(orchestratorUrl);
    } catch (error) {
      throw new Error(
        `config.toml: app.bash_tools.docker.orchestrator_url is invalid (${error instanceof Error ? error.message : "unknown error"})`
      );
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        'config.toml: app.bash_tools.docker.orchestrator_url must be http(s)'
      );
    }

    docker = {
      orchestratorUrl: url.toString().replace(/\/+$/, ""),
      adminTokenEnv:
        String(rawDocker.admin_token_env ?? "REMCOCHAT_ADMIN_TOKEN").trim() ||
        "REMCOCHAT_ADMIN_TOKEN",
      networkMode: rawDocker.network_mode ?? "default",
      memoryMb: clampInt(rawDocker.memory_mb, 256, 16_384, 2048),
    };
  } else if (provider !== "vercel") {
    throw new Error(
      'config.toml: app.bash_tools.provider must be "vercel" or "docker"'
    );
  }

  const sandboxRuntimeDefault = provider === "docker" ? "node24" : "node22";
  const sandboxRuntime =
    String(bashTools.sandbox?.runtime ?? sandboxRuntimeDefault).trim() ||
    sandboxRuntimeDefault;
  if (
    provider === "docker" &&
    sandboxRuntime !== "node24" &&
    sandboxRuntime !== "python3.13"
  ) {
    throw new Error(
      'config.toml: app.bash_tools.sandbox.runtime must be "node24" or "python3.13" when provider = "docker"'
    );
  }

  const sandboxPortsRaw = bashTools.sandbox?.ports;
  const sandboxPorts = Array.isArray(sandboxPortsRaw)
    ? Array.from(
        new Set(
          sandboxPortsRaw
            .map((port) => Math.floor(Number(port)))
            .filter((port) => Number.isFinite(port) && port >= 1 && port <= 65535)
        )
      ).slice(0, 4)
    : [3000];

  const seedMode = bashTools.seed?.mode ?? "git";
  const gitUrlRaw = String(bashTools.seed?.git_url ?? "").trim();
  const gitRevisionRaw = String(bashTools.seed?.git_revision ?? "").trim();
  const gitUrl = gitUrlRaw ? gitUrlRaw : null;
  const gitRevision = gitRevisionRaw ? gitRevisionRaw : null;
  const uploadInclude =
    String(bashTools.seed?.upload_include ?? "**/*").trim() || "**/*";

  if (seedMode === "git") {
    if (!gitUrl) {
      throw new Error(
        'config.toml: app.bash_tools.seed.git_url is required when seed.mode = "git"'
      );
    }
  } else if (seedMode === "upload") {
    if (!projectRoot) {
      throw new Error(
        'config.toml: app.bash_tools.project_root is required when seed.mode = "upload"'
      );
    }
  }

  return {
    enabled: true,
    provider,
    access,
    projectRoot,
    maxStdoutChars: clampInt(bashTools.max_stdout_chars, 200, 200_000, 12_000),
    maxStderrChars: clampInt(bashTools.max_stderr_chars, 200, 200_000, 12_000),
    timeoutMs: clampInt(bashTools.timeout_ms, 1_000, 5 * 60_000, 30_000),
    maxConcurrentSandboxes: clampInt(
      bashTools.max_concurrent_sandboxes,
      1,
      10,
      2
    ),
    idleTtlMs: clampInt(
      bashTools.idle_ttl_ms,
      10_000,
      6 * 60 * 60_000,
      900_000
    ),
    docker,
    sandbox: {
      runtime: sandboxRuntime,
      ports: sandboxPorts,
      vcpus: clampInt(bashTools.sandbox?.vcpus, 1, 8, 2),
      timeoutMs: clampInt(
        bashTools.sandbox?.timeout_ms,
        30_000,
        5 * 60 * 60_000,
        900_000
      ),
    },
    seed: {
      mode: seedMode,
      gitUrl,
      gitRevision,
      uploadInclude,
    },
  };
}

export function normalizeHueGateway(
  rawHueGateway: RawHueGatewayConfig | undefined
): RemcoChatConfig["hueGateway"] {
  const hueGateway = rawHueGateway ?? {};
  if (!Boolean(hueGateway.enabled ?? false)) {
    return null;
  }

  const authHeaderEnv = String(hueGateway.auth_header_env ?? "HUE_AUTH_HEADER").trim();
  const bearerTokenEnv = String(hueGateway.bearer_token_env ?? "HUE_TOKEN").trim();
  const apiKeyEnv = String(hueGateway.api_key_env ?? "HUE_API_KEY").trim();
  if (!authHeaderEnv || !bearerTokenEnv || !apiKeyEnv) {
    throw new Error(
      "config.toml: app.hue_gateway.*_env values must be non-empty environment variable names"
    );
  }

  return {
    enabled: true,
    access: hueGateway.access ?? "localhost",
    baseUrls: normalizeServiceBaseUrls(
      hueGateway.base_urls,
      [
        "http://hue-gateway:8000",
        "http://host.docker.internal:8000",
        "http://localhost:8000",
      ],
      { configPath: "app.hue_gateway", keepPath: false }
    ),
    timeoutMs: clampInt(hueGateway.timeout_ms, 1_000, 120_000, 8_000),
    authHeaderEnv,
    bearerTokenEnv,
    apiKeyEnv,
  };
}

export function normalizeOvNl(
  rawOvNl: RawOvNlConfig | undefined
): RemcoChatConfig["ovNl"] {
  const ovNl = rawOvNl ?? {};
  if (!Boolean(ovNl.enabled ?? false)) {
    return null;
  }

  const subscriptionKeyEnv = String(
    ovNl.subscription_key_env ?? "NS_APP_SUBSCRIPTION_KEY"
  ).trim();
  if (!subscriptionKeyEnv) {
    throw new Error(
      "config.toml: app.ov_nl.subscription_key_env must be a non-empty environment variable name"
    );
  }

  return {
    enabled: true,
    access: ovNl.access ?? "localhost",
    baseUrls: normalizeServiceBaseUrls(
      ovNl.base_urls,
      ["https://gateway.apiportal.ns.nl/reisinformatie-api"],
      { configPath: "app.ov_nl", keepPath: true }
    ),
    timeoutMs: clampInt(ovNl.timeout_ms, 1_000, 120_000, 8_000),
    subscriptionKeyEnv,
    cacheMaxTtlSeconds: clampInt(ovNl.cache_max_ttl_seconds, 1, 3_600, 60),
  };
}

export function normalizeAttachments(
  rawAttachments: RawAttachmentsConfig | undefined
): RemcoChatConfig["attachments"] {
  const attachments = rawAttachments ?? {};
  const defaultAllowedMediaTypes = [
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/pdf",
  ];
  const allowedMediaTypes = Array.from(
    new Set(
      (Array.isArray(attachments.allowed_media_types)
        ? attachments.allowed_media_types
        : defaultAllowedMediaTypes
      )
        .map((type) => String(type).trim())
        .filter(Boolean)
    )
  );

  return {
    enabled: Boolean(attachments.enabled ?? true),
    allowedMediaTypes,
    maxFilesPerMessage: clampInt(attachments.max_files_per_message, 1, 20, 3),
    maxFileSizeBytes: clampInt(
      attachments.max_file_size_bytes,
      1,
      50_000_000,
      2_000_000
    ),
    maxTotalSizeBytes: Math.min(
      200_000_000,
      Math.max(
        clampInt(attachments.max_file_size_bytes, 1, 50_000_000, 2_000_000),
        Math.floor(Number(attachments.max_total_size_bytes ?? 5_000_000))
      )
    ),
    maxExtractedTextChars: clampInt(
      attachments.max_extracted_text_chars,
      200,
      2_000_000,
      120_000
    ),
    temporaryTtlMs: clampInt(
      attachments.temporary_ttl_ms,
      10_000,
      30 * 24 * 60 * 60_000,
      6 * 60 * 60_000
    ),
    sandbox: {
      runtime: String(attachments.sandbox?.runtime ?? "node22").trim() || "node22",
      vcpus: clampInt(attachments.sandbox?.vcpus, 1, 8, 2),
      timeoutMs: clampInt(
        attachments.sandbox?.timeout_ms,
        30_000,
        5 * 60 * 60_000,
        900_000
      ),
    },
    processing: {
      timeoutMs: clampInt(
        attachments.processing?.timeout_ms,
        1_000,
        10 * 60_000,
        30_000
      ),
      maxStdoutChars: clampInt(
        attachments.processing?.max_stdout_chars,
        200,
        200_000,
        200_000
      ),
      maxStderrChars: clampInt(
        attachments.processing?.max_stderr_chars,
        200,
        200_000,
        20_000
      ),
    },
  };
}
