type QueryValue = string | number | boolean;

export type OvNlClientErrorCode =
  | "upstream_unreachable"
  | "upstream_http_error"
  | "upstream_invalid_response";

export type OvNlClientError = {
  code: OvNlClientErrorCode;
  message: string;
  status?: number;
  details: Record<string, unknown>;
};

export type OvNlHttpResult =
  | {
      ok: true;
      status: number;
      headers: Headers;
      json: unknown;
      cacheMaxAgeSeconds: number | null;
      baseUrl: string;
      requestUrl: string;
    }
  | {
      ok: false;
      error: OvNlClientError;
    };

let cachedPreferredBaseUrl: string | null = null;

function normalizeBaseUrl(raw: string): string {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    if (parsed.search || parsed.hash) return "";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function buildRequestUrl(input: {
  baseUrl: string;
  path: string;
  query?: Record<string, QueryValue | QueryValue[] | null | undefined>;
}): string {
  const normalizedPath = String(input.path ?? "").trim();
  const base = String(input.baseUrl ?? "").replace(/\/+$/, "");
  const pathname = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  const url = new URL(`${base}${pathname}`);

  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item == null) continue;
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function parseCacheControlMaxAgeSeconds(cacheControl: string | null): number | null {
  const value = String(cacheControl ?? "").trim();
  if (!value) return null;

  for (const rawPart of value.split(",")) {
    const part = rawPart.trim().toLowerCase();
    if (!part.startsWith("max-age=")) continue;
    const parsed = Number(part.slice("max-age=".length));
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    return Math.floor(parsed);
  }

  return null;
}

async function fetchWithTimeout(input: {
  requestUrl: string;
  timeoutMs: number;
  init: RequestInit;
}): Promise<Response> {
  const timeoutMs = Math.max(1_000, Math.floor(Number(input.timeoutMs ?? 8_000)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input.requestUrl, { ...input.init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function toErrorMessageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const maybe = body as { message?: unknown; errors?: unknown[] };
  if (typeof maybe.message === "string" && maybe.message.trim()) {
    return maybe.message.trim();
  }
  if (Array.isArray(maybe.errors) && maybe.errors.length > 0) {
    const first = maybe.errors[0] as { message?: unknown };
    if (typeof first?.message === "string" && first.message.trim()) {
      return first.message.trim();
    }
  }
  return fallback;
}

function toHttpError(input: {
  status: number;
  baseUrl: string;
  requestUrl: string;
  body: unknown;
}): OvNlClientError {
  const fallback = `NS Reisinformatie API returned HTTP ${input.status}.`;
  const message = toErrorMessageFromBody(input.body, fallback);
  const details: Record<string, unknown> = {
    status: input.status,
    baseUrl: input.baseUrl,
    requestUrl: input.requestUrl,
  };

  if (input.body && typeof input.body === "object") {
    const b = input.body as Record<string, unknown>;
    if (typeof b.code === "number") details.upstreamCode = b.code;
    if (typeof b.path === "string") details.upstreamPath = b.path;
    if (typeof b.requestId === "string") details.upstreamRequestId = b.requestId;
  }

  return {
    code: "upstream_http_error",
    message,
    status: input.status,
    details,
  };
}

export async function getOvNlJson(input: {
  baseUrls: string[];
  timeoutMs: number;
  subscriptionKey: string;
  path: string;
  query?: Record<string, QueryValue | QueryValue[] | null | undefined>;
  headers?: Record<string, string>;
}): Promise<OvNlHttpResult> {
  const baseUrls = Array.from(
    new Set((input.baseUrls ?? []).map((u) => normalizeBaseUrl(u)).filter(Boolean))
  );
  if (baseUrls.length === 0) {
    return {
      ok: false,
      error: {
        code: "upstream_unreachable",
        message: "OV NL base URL list is empty.",
        details: {},
      },
    };
  }

  const preferred = cachedPreferredBaseUrl
    ? normalizeBaseUrl(cachedPreferredBaseUrl)
    : "";
  const candidateBaseUrls = [
    ...(preferred && baseUrls.includes(preferred) ? [preferred] : []),
    ...baseUrls.filter((u) => u !== preferred),
  ];

  let lastError: OvNlClientError | null = null;
  const maxAttemptsPerBaseUrl = 2;

  for (const baseUrl of candidateBaseUrls) {
    const requestUrl = buildRequestUrl({
      baseUrl,
      path: input.path,
      query: input.query,
    });

    for (let attempt = 1; attempt <= maxAttemptsPerBaseUrl; attempt += 1) {
      let response: Response;
      try {
        response = await fetchWithTimeout({
          requestUrl,
          timeoutMs: input.timeoutMs,
          init: {
            method: "GET",
            headers: {
              accept: "application/json",
              "Ocp-Apim-Subscription-Key": input.subscriptionKey,
              ...(input.headers ?? {}),
            },
            cache: "no-store",
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err ?? "");
        lastError = {
          code: "upstream_unreachable",
          message: "Failed to reach NS Reisinformatie API.",
          details: {
            baseUrl,
            requestUrl,
            attempt,
            cause: message || "unknown_error",
          },
        };

        if (attempt < maxAttemptsPerBaseUrl) continue;
        break;
      }

      const text = await response.text();
      let body: unknown = null;
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          lastError = {
            code: "upstream_invalid_response",
            message: "NS Reisinformatie API returned a non-JSON response.",
            status: response.status,
            details: {
              baseUrl,
              requestUrl,
              attempt,
              responsePreview: text.slice(0, 400),
            },
          };
          if (response.status >= 500 && attempt < maxAttemptsPerBaseUrl) continue;
          if (response.status >= 500) break;
          return { ok: false, error: lastError };
        }
      }

      if (!response.ok) {
        lastError = toHttpError({
          status: response.status,
          baseUrl,
          requestUrl,
          body,
        });
        lastError.details.attempt = attempt;

        if (response.status >= 500 && attempt < maxAttemptsPerBaseUrl) continue;
        if (response.status >= 500) break;
        return { ok: false, error: lastError };
      }

      cachedPreferredBaseUrl = baseUrl;
      return {
        ok: true,
        status: response.status,
        headers: response.headers,
        json: body,
        cacheMaxAgeSeconds: parseCacheControlMaxAgeSeconds(
          response.headers.get("cache-control")
        ),
        baseUrl,
        requestUrl,
      };
    }
  }

  return {
    ok: false,
    error:
      lastError ??
      {
        code: "upstream_unreachable",
        message: "Failed to reach NS Reisinformatie API.",
        details: {},
      },
  };
}

export const __test__ = {
  parseCacheControlMaxAgeSeconds,
  normalizeBaseUrl,
  buildRequestUrl,
  resetPreferredBaseUrl() {
    cachedPreferredBaseUrl = null;
  },
};
