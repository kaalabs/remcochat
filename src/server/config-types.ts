export const MODEL_TYPES = [
  "vercel_ai_gateway",
  "openai_responses",
  "openai_compatible",
  "xai",
  "anthropic_messages",
  "google_generative_ai",
] as const;

export type ModelType = (typeof MODEL_TYPES)[number];

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
  localAccess: {
    enabled: true;
    allowedCommands: string[];
    allowedDirectories: string[];
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
    searchProvider: "exa" | "brave";
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
  hueGateway: {
    enabled: boolean;
    access: "localhost" | "lan";
    baseUrls: string[];
    timeoutMs: number;
    authHeaderEnv: string;
    bearerTokenEnv: string;
    apiKeyEnv: string;
  } | null;
  ovNl: {
    enabled: boolean;
    access: "localhost" | "lan";
    baseUrls: string[];
    timeoutMs: number;
    subscriptionKeyEnv: string;
    cacheMaxTtlSeconds: number;
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
