type DockerSandboxClient = {
  createOrReconnectSandbox(input: {
    sessionKey: string;
    runtime: string;
    idleTtlMs: number;
    resources: { vcpus: number; memoryMb: number };
    network: { mode: "default" | "none" };
    ports?: number[];
  }): Promise<{ sandboxId: string; created: boolean }>;
  startCommand(
    sandboxId: string,
    input: {
      cmd: string;
      args: string[];
      timeoutMs: number;
      detached: boolean;
    }
  ): Promise<{ commandId: string }>;
  waitCommand(sandboxId: string, commandId: string): Promise<{ exitCode: number }>;
  killCommand(sandboxId: string, commandId: string): Promise<{ ok: boolean }>;
  getPortUrl(
    sandboxId: string,
    port: number
  ): Promise<{ found: boolean; hostPort?: number; url?: string }>;
  streamLogs(
    sandboxId: string,
    commandId: string,
    input?: { abortSignal?: AbortSignal }
  ): AsyncGenerator<{ stream: "stdout" | "stderr"; data: string }>;
  readFile(
    sandboxId: string,
    path: string
  ): Promise<{ found: boolean; contentBase64?: string }>;
  writeFiles(
    sandboxId: string,
    files: Array<{ path: string; contentBase64: string }>
  ): Promise<{ ok: boolean }>;
  stopSandbox(sandboxId: string): Promise<{ ok: boolean }>;
};

function tokenFromEnv(envName: string): string | null {
  const key = String(envName ?? "").trim();
  if (!key) return null;
  const value = String(process.env[key] ?? "").trim();
  return value || null;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  adminToken: string | null
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  if (adminToken) headers.set("x-remcochat-admin-token", adminToken);

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sandboxd ${res.status}: ${text || res.statusText}`);
  }
  return await res.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : String(value ?? "");
}

function getBoolean(obj: Record<string, unknown>, key: string): boolean {
  return Boolean(obj[key]);
}

function getNumber(obj: Record<string, unknown>, key: string, fallback: number): number {
  const n = Number(obj[key]);
  return Number.isFinite(n) ? n : fallback;
}

async function* parseNdjsonStream(
  body: ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      if (abortSignal?.aborted) throw new Error("Aborted");
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        yield JSON.parse(line) as unknown;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export function createDockerSandboxClient(input: {
  orchestratorUrl: string;
  adminTokenEnv: string;
}): DockerSandboxClient {
  const baseUrl = String(input.orchestratorUrl ?? "").replace(/\/+$/, "");
  const adminToken = tokenFromEnv(input.adminTokenEnv);

  return {
    async createOrReconnectSandbox(payload) {
      const json = await fetchJson(
        `${baseUrl}/v1/sandboxes`,
        { method: "POST", body: JSON.stringify(payload) },
        adminToken
      );
      const rec = isRecord(json) ? json : {};
      return {
        sandboxId: getString(rec, "sandboxId"),
        created: getBoolean(rec, "created"),
      };
    },
    async startCommand(sandboxId, payload) {
      const json = await fetchJson(
        `${baseUrl}/v1/sandboxes/${encodeURIComponent(sandboxId)}/commands`,
        { method: "POST", body: JSON.stringify(payload) },
        adminToken
      );
      const rec = isRecord(json) ? json : {};
      return { commandId: getString(rec, "commandId") };
    },
    async waitCommand(sandboxId, commandId) {
      const json = await fetchJson(
        `${baseUrl}/v1/sandboxes/${encodeURIComponent(sandboxId)}/commands/${encodeURIComponent(commandId)}/wait`,
        { method: "GET" },
        adminToken
      );
      const rec = isRecord(json) ? json : {};
      return { exitCode: getNumber(rec, "exitCode", 1) };
    },
    async killCommand(sandboxId, commandId) {
      const json = await fetchJson(
        `${baseUrl}/v1/sandboxes/${encodeURIComponent(sandboxId)}/commands/${encodeURIComponent(commandId)}:kill`,
        { method: "POST" },
        adminToken
      );
      const rec = isRecord(json) ? json : {};
      return { ok: getBoolean(rec, "ok") };
    },
    async getPortUrl(sandboxId, port) {
      const json = await fetchJson(
        `${baseUrl}/v1/sandboxes/${encodeURIComponent(sandboxId)}/ports/${encodeURIComponent(
          String(port)
        )}`,
        { method: "GET" },
        adminToken
      );
      const rec = isRecord(json) ? json : {};
      const found = getBoolean(rec, "found");
      if (!found) return { found: false };
      const hostPort = getNumber(rec, "hostPort", 0);
      return {
        found: true,
        hostPort: Number.isFinite(hostPort) ? hostPort : 0,
        url: typeof rec.url === "string" ? rec.url : undefined,
      };
    },
    async *streamLogs(sandboxId, commandId, opts) {
      const headers = new Headers();
      if (adminToken) headers.set("x-remcochat-admin-token", adminToken);
      const res = await fetch(
        `${baseUrl}/v1/sandboxes/${encodeURIComponent(sandboxId)}/commands/${encodeURIComponent(commandId)}/logs`,
        { method: "GET", headers, signal: opts?.abortSignal }
      );
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`sandboxd ${res.status}: ${text || res.statusText}`);
      }

      for await (const line of parseNdjsonStream(res.body, opts?.abortSignal)) {
        const obj = isRecord(line) ? line : {};
        const stream = getString(obj, "stream");
        const data = typeof obj.data === "string" ? obj.data : "";
        if (stream !== "stdout" && stream !== "stderr") continue;
        yield { stream, data } as { stream: "stdout" | "stderr"; data: string };
      }
    },
    async readFile(sandboxId, filePath) {
      const json = await fetchJson(
        `${baseUrl}/v1/sandboxes/${encodeURIComponent(sandboxId)}/files:read?path=${encodeURIComponent(
          filePath
        )}`,
        { method: "GET" },
        adminToken
      );
      const rec = isRecord(json) ? json : {};
      const found = getBoolean(rec, "found");
      if (!found) return { found: false };
      return {
        found: true,
        contentBase64: typeof rec.contentBase64 === "string" ? rec.contentBase64 : "",
      };
    },
    async writeFiles(sandboxId, files) {
      const json = await fetchJson(
        `${baseUrl}/v1/sandboxes/${encodeURIComponent(sandboxId)}/files:write`,
        { method: "POST", body: JSON.stringify({ files }) },
        adminToken
      );
      const rec = isRecord(json) ? json : {};
      return { ok: getBoolean(rec, "ok") };
    },
    async stopSandbox(sandboxId) {
      const json = await fetchJson(
        `${baseUrl}/v1/sandboxes/${encodeURIComponent(sandboxId)}:stop`,
        { method: "POST" },
        adminToken
      );
      const rec = isRecord(json) ? json : {};
      return { ok: getBoolean(rec, "ok") };
    },
  };
}
