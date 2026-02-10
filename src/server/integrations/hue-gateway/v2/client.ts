import { setTimeout as delay } from "node:timers/promises";

export type HueGatewayClientError = {
  code: "gateway_unreachable";
  message: string;
  details: Record<string, unknown>;
};

export type HueGatewayHttpResult =
  | {
      ok: true;
      status: number;
      headers: Headers;
      text: string;
    }
  | {
      ok: false;
      error: HueGatewayClientError;
    };

let cachedReadyBaseUrl: string | null = null;

async function fetchTextWithTimeout(input: {
  url: string;
  init: RequestInit;
  timeoutMs: number;
}): Promise<HueGatewayHttpResult> {
  const timeoutMs = Math.max(1_000, Math.floor(input.timeoutMs));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input.url, { ...input.init, signal: controller.signal });
    const text = await res.text();
    return { ok: true, status: res.status, headers: res.headers, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    return {
      ok: false,
      error: {
        code: "gateway_unreachable",
        message: "Failed to reach Hue Gateway.",
        details: { cause: message || "unknown_error" },
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function selectReadyBaseUrl(input: {
  baseUrls: string[];
  timeoutMs: number;
}): Promise<{ ok: true; baseUrl: string } | { ok: false; error: HueGatewayClientError }> {
  const baseUrls = input.baseUrls.map((u) => String(u ?? "").trim().replace(/\/+$/, "")).filter(Boolean);
  if (baseUrls.length === 0) {
    return {
      ok: false,
      error: {
        code: "gateway_unreachable",
        message: "Hue Gateway base URL list is empty.",
        details: {},
      },
    };
  }

  const probeTimeoutMs = Math.min(2_000, Math.max(1_000, Math.floor(input.timeoutMs)));
  for (const baseUrl of baseUrls) {
    const health = await fetchTextWithTimeout({
      url: `${baseUrl}/healthz`,
      init: { method: "GET" },
      timeoutMs: probeTimeoutMs,
    });
    if (!health.ok || health.status < 200 || health.status >= 300) continue;

    const ready = await fetchTextWithTimeout({
      url: `${baseUrl}/readyz`,
      init: { method: "GET" },
      timeoutMs: probeTimeoutMs,
    });
    if (!ready.ok || ready.status < 200 || ready.status >= 300) continue;

    try {
      const json = JSON.parse(ready.text) as { ready?: unknown };
      if (json && json.ready === true) {
        return { ok: true, baseUrl };
      }
    } catch {
      // ignore invalid readyz JSON; try next base URL
    }
  }

  return {
    ok: false,
    error: {
      code: "gateway_unreachable",
      message: "Hue Gateway is not reachable or not ready from this environment.",
      details: { tried: baseUrls },
    },
  };
}

export async function postHueGatewayV2Action(input: {
  baseUrls: string[];
  timeoutMs: number;
  authHeaderLine: string;
  requestId: string;
  idempotencyKey?: string;
  body: unknown;
}): Promise<HueGatewayHttpResult> {
  let baseUrl = cachedReadyBaseUrl;
  if (!baseUrl) {
    const selected = await selectReadyBaseUrl({
      baseUrls: input.baseUrls,
      timeoutMs: input.timeoutMs,
    });
    if (!selected.ok) return { ok: false, error: selected.error };
    baseUrl = selected.baseUrl;
    cachedReadyBaseUrl = baseUrl;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": input.requestId,
  };

  const authHeader = String(input.authHeaderLine ?? "").trim();
  if (authHeader) {
    const idx = authHeader.indexOf(":");
    if (idx > 0) {
      const k = authHeader.slice(0, idx).trim();
      const v = authHeader.slice(idx + 1).trim();
      if (k && v) headers[k] = v;
    }
  }

  if (input.idempotencyKey) {
    headers["Idempotency-Key"] = input.idempotencyKey;
  }

  const res = await fetchTextWithTimeout({
    url: `${baseUrl}/v2/actions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
    },
    timeoutMs: input.timeoutMs,
  });

  if (!res.ok) {
    cachedReadyBaseUrl = null;
    return res;
  }

  // If the selected base URL is up but intermittently failing, allow one re-select + retry.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    cachedReadyBaseUrl = null;
    const selected = await selectReadyBaseUrl({
      baseUrls: input.baseUrls,
      timeoutMs: input.timeoutMs,
    });
    if (!selected.ok) return res;
    cachedReadyBaseUrl = selected.baseUrl;
    await delay(10);
    return fetchTextWithTimeout({
      url: `${selected.baseUrl}/v2/actions`,
      init: {
        method: "POST",
        headers,
        body: JSON.stringify(input.body),
      },
      timeoutMs: input.timeoutMs,
    });
  }

  return res;
}
