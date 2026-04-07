import type { ModelCapabilities } from "@/lib/models";

export type ProviderSwitcherResponse = {
  loadedAt: string;
  defaultProviderId: string;
  activeProviderId: string;
  providers: Array<{
    id: string;
    name: string;
    defaultModelId: string;
    active: boolean;
    default: boolean;
    status: "ready" | "degraded";
    loadError: string | null;
  }>;
};

export type ModelsInventoryResponse = {
  loadedAt: string;
  configPath: string;
  modelsdevVersion: string;
  router: { enabled: boolean; providerId: string; modelId: string } | null;
  providers: Array<{
    id: string;
    name: string;
    modelsdevProviderId: string;
    defaultModelId: string;
    allowedModelIds: string[];
    requiredModelIds: string[];
    apiKeyEnv: string;
    baseUrl: string;
    models: Array<{
      id: string;
      label: string;
      description?: string;
      npm: string | null;
      modelType: string | null;
      supported: boolean;
      capabilities: ModelCapabilities;
      contextWindow?: number;
    }>;
  }>;
};

export type SkillsAdminResponse = {
  enabled: boolean;
  scannedAt?: number;
  scanRoots?: string[];
  scanRootsMeta?: Array<{ root: string; exists: boolean; skillsCount: number }>;
  skills?: Array<{
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string;
    detectedTools?: string[];
    sourceDir?: string;
    skillDir?: string;
    skillMdPath?: string;
  }>;
  invalid?: Array<{ skillDir: string; skillMdPath: string; error: string }>;
  collisions?: Array<{
    name: string;
    winner: { sourceDir: string; skillDir: string; skillMdPath: string };
    losers: Array<{ sourceDir: string; skillDir: string; skillMdPath: string }>;
  }>;
  warnings?: string[];
  status?: { enabled: boolean; registryLoaded: boolean };
  usage?: {
    chatsWithAnyActivatedSkills: number;
    activatedSkillCounts: Record<string, number>;
  };
};

export type WebSearchProviderResponse = {
  enabled: boolean;
  selectedProviderId: string;
  providers: Array<{ id: string; label: string }>;
};

export type LocalAccessResponse = {
  configured: boolean;
  enabled: boolean;
  allowedCommands: string[];
  allowedDirectories: string[];
};

export type ReadinessPreflightResponse = {
  webTools: { enabled: boolean };
  tools: {
    hueGateway: "enabled" | "disabled" | "blocked";
    ovNlGateway: "enabled" | "disabled" | "blocked";
  };
};

type AdminErrorJson = {
  error?: string;
} | null;

type AdminFetchOptions = {
  fallbackErrorMessage: string;
  headers?: Record<string, string>;
};

export function resolveAdminTransportError(input: {
  fallbackErrorMessage: string;
  json: AdminErrorJson;
}) {
  return String(input.json?.error ?? "").trim() || input.fallbackErrorMessage;
}

export function buildSkillsAdminPath(options?: { rescan?: boolean }) {
  return options?.rescan ? "/api/skills?rescan=1" : "/api/skills";
}

export function createAdminJsonRequestInit(input: {
  body: unknown;
  headers?: Record<string, string>;
  method: "POST" | "PUT";
}): RequestInit {
  return {
    method: input.method,
    headers: { "Content-Type": "application/json", ...input.headers },
    body: JSON.stringify(input.body),
  };
}

async function readAdminErrorJson(response: Response): Promise<AdminErrorJson> {
  return (await response.json().catch(() => null)) as AdminErrorJson;
}

async function fetchAdminJsonOrThrow<T>(
  input: AdminFetchOptions & {
    init?: RequestInit;
    url: string;
  }
): Promise<T> {
  const response = await fetch(input.url, {
    cache: "no-store",
    headers: input.headers,
    ...input.init,
  });

  if (!response.ok) {
    throw new Error(
      resolveAdminTransportError({
        fallbackErrorMessage: input.fallbackErrorMessage,
        json: await readAdminErrorJson(response),
      })
    );
  }

  return (await response.json()) as T;
}

export function fetchAdminProviderSwitcher(input: {
  fallbackErrorMessage: string;
}) {
  return fetchAdminJsonOrThrow<ProviderSwitcherResponse>({
    fallbackErrorMessage: input.fallbackErrorMessage,
    url: "/api/admin/providers/switcher",
  });
}

export async function warmAdminProvidersCatalog(input: {
  fallbackErrorMessage: string;
}) {
  await fetchAdminJsonOrThrow<unknown>({
    fallbackErrorMessage: input.fallbackErrorMessage,
    url: "/api/providers",
  });
}

export function fetchAdminModelsInventory(input: {
  fallbackErrorMessage: string;
}) {
  return fetchAdminJsonOrThrow<ModelsInventoryResponse>({
    fallbackErrorMessage: input.fallbackErrorMessage,
    url: "/api/admin/models-inventory",
  });
}

export function fetchAdminSkills(input: AdminFetchOptions & { rescan?: boolean }) {
  return fetchAdminJsonOrThrow<SkillsAdminResponse>({
    fallbackErrorMessage: input.fallbackErrorMessage,
    headers: input.headers,
    url: buildSkillsAdminPath({ rescan: input.rescan }),
  });
}

export function fetchAdminWebSearchProvider(input: {
  fallbackErrorMessage: string;
}) {
  return fetchAdminJsonOrThrow<WebSearchProviderResponse>({
    fallbackErrorMessage: input.fallbackErrorMessage,
    url: "/api/admin/web-tools/search-provider",
  });
}

export function fetchAdminLocalAccess(input: {
  fallbackErrorMessage: string;
}) {
  return fetchAdminJsonOrThrow<LocalAccessResponse>({
    fallbackErrorMessage: input.fallbackErrorMessage,
    url: "/api/admin/local-access",
  });
}

export async function fetchAdminReadinessPreflight(input: {
  headers?: Record<string, string>;
}) {
  const response = await fetch("/api/admin/readiness/preflight", {
    cache: "no-store",
    headers: input.headers,
  });
  if (!response.ok) return null;

  return (await response
    .json()
    .catch(() => null)) as ReadinessPreflightResponse | null;
}

export async function postAdminReadinessRun(input: {
  body: unknown;
  headers?: Record<string, string>;
}) {
  const response = await fetch("/api/admin/readiness/run", {
    ...createAdminJsonRequestInit({
      body: input.body,
      headers: input.headers,
      method: "POST",
    }),
  });
  if (!response.ok) return null;

  return (await response.json().catch(() => null)) as { status?: string } | null;
}

async function mutateAdminJsonOrThrow(
  input: AdminFetchOptions & {
    body: unknown;
    method: "POST" | "PUT";
    url: string;
  }
) {
  const response = await fetch(input.url, {
    ...createAdminJsonRequestInit({
      body: input.body,
      headers: input.headers,
      method: input.method,
    }),
  });

  if (!response.ok) {
    throw new Error(
      resolveAdminTransportError({
        fallbackErrorMessage: input.fallbackErrorMessage,
        json: await readAdminErrorJson(response),
      })
    );
  }
}

export function updateAdminActiveProvider(input: {
  fallbackErrorMessage: string;
  providerId: string;
}) {
  return mutateAdminJsonOrThrow({
    body: { providerId: input.providerId },
    fallbackErrorMessage: input.fallbackErrorMessage,
    method: "PUT",
    url: "/api/providers/active",
  });
}

export function resetAdminData(input: {
  confirm: string;
  fallbackErrorMessage: string;
}) {
  return mutateAdminJsonOrThrow({
    body: { confirm: input.confirm },
    fallbackErrorMessage: input.fallbackErrorMessage,
    method: "POST",
    url: "/api/admin/reset",
  });
}

export function updateAdminAllowedModels(input: {
  allowedModelIds: string[];
  fallbackErrorMessage: string;
  providerId: string;
}) {
  return mutateAdminJsonOrThrow({
    body: {
      providerId: input.providerId,
      allowedModelIds: input.allowedModelIds,
    },
    fallbackErrorMessage: input.fallbackErrorMessage,
    method: "PUT",
    url: "/api/admin/providers/allowed-models",
  });
}

export function updateAdminDefaultModel(input: {
  defaultModelId: string;
  fallbackErrorMessage: string;
  providerId: string;
}) {
  return mutateAdminJsonOrThrow({
    body: {
      providerId: input.providerId,
      defaultModelId: input.defaultModelId,
    },
    fallbackErrorMessage: input.fallbackErrorMessage,
    method: "PUT",
    url: "/api/admin/providers/default-model",
  });
}

export function updateAdminRouterModel(input: {
  fallbackErrorMessage: string;
  modelId: string;
  providerId: string;
}) {
  return mutateAdminJsonOrThrow({
    body: {
      providerId: input.providerId,
      modelId: input.modelId,
    },
    fallbackErrorMessage: input.fallbackErrorMessage,
    method: "PUT",
    url: "/api/admin/router/model",
  });
}

export function updateAdminWebSearchProvider(input: {
  fallbackErrorMessage: string;
  providerId: string;
}) {
  return mutateAdminJsonOrThrow({
    body: { providerId: input.providerId },
    fallbackErrorMessage: input.fallbackErrorMessage,
    method: "PUT",
    url: "/api/admin/web-tools/search-provider",
  });
}

export function updateAdminLocalAccess(input: {
  allowedCommands: string[];
  allowedDirectories: string[];
  enabled: boolean;
  fallbackErrorMessage: string;
}) {
  return mutateAdminJsonOrThrow({
    body: {
      enabled: input.enabled,
      allowedCommands: input.allowedCommands,
      allowedDirectories: input.allowedDirectories,
    },
    fallbackErrorMessage: input.fallbackErrorMessage,
    method: "PUT",
    url: "/api/admin/local-access",
  });
}
