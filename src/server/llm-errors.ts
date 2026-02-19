type OpenAIErrorEnvelope = {
  error?: {
    code?: unknown;
    message?: unknown;
    type?: unknown;
    param?: unknown;
  };
};

type HeadersLike = Record<string, unknown> | Headers;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function tryParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function tryParseOpenAIErrorEnvelopeFromBody(body: unknown): OpenAIErrorEnvelope | null {
  if (typeof body !== "string") return null;
  const raw = body.trim();
  if (!raw) return null;

  // Some gateways prepend an OpenAI-style JSON error and then continue streaming SSE.
  // Try to parse up to the first SSE "event:" marker.
  const eventIndex = raw.indexOf("event:");
  const jsonCandidate = (eventIndex > 0 ? raw.slice(0, eventIndex) : raw).trim();
  const parsed = tryParseJSON(jsonCandidate);
  if (!isRecord(parsed)) return null;

  const error = (parsed as OpenAIErrorEnvelope).error;
  if (!isRecord(error)) return null;
  return parsed as OpenAIErrorEnvelope;
}

function headerValue(headers: unknown, key: string): string | null {
  if (!headers) return null;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const value = headers.get(key);
    return asNonEmptyString(value);
  }
  if (isRecord(headers)) {
    const direct = headers[key];
    if (typeof direct === "string") return asNonEmptyString(direct);
    const lower = headers[key.toLowerCase()];
    if (typeof lower === "string") return asNonEmptyString(lower);
  }
  return null;
}

export function formatLlmCallErrorForUser(
  err: unknown,
  ctx?: {
    providerName?: string;
    providerId?: string;
    baseUrl?: string;
    modelType?: string;
    providerModelId?: string;
  },
): string {
  const statusCode =
    typeof (err as { statusCode?: unknown })?.statusCode === "number"
      ? ((err as { statusCode: number }).statusCode as number)
      : null;
  const url = asNonEmptyString((err as { url?: unknown })?.url);
  const responseBody = (err as { responseBody?: unknown })?.responseBody;
  const responseHeaders = (err as { responseHeaders?: unknown })?.responseHeaders as HeadersLike | undefined;
  const envelope = tryParseOpenAIErrorEnvelopeFromBody(responseBody);
  const code = envelope ? asNonEmptyString(envelope.error?.code) : null;
  const message = envelope ? asNonEmptyString(envelope.error?.message) : null;

  const providerLabel = ctx?.providerName
    ? `Provider "${ctx.providerName}"`
    : ctx?.providerId
      ? `Provider "${ctx.providerId}"`
      : "Provider";

  if (statusCode === 403 && code === "unsupported_country_region_territory") {
    const baseUrlHint = ctx?.baseUrl ? ` (base_url=${ctx.baseUrl})` : "";
    const cfPlacement = headerValue(responseHeaders, "cf-placement");
    const cfRay = headerValue(responseHeaders, "cf-ray");
    const placementHint =
      cfPlacement || cfRay
        ? `\nCloudflare: ${[cfPlacement ? `cf-placement=${cfPlacement}` : null, cfRay ? `cf-ray=${cfRay}` : null]
            .filter(Boolean)
            .join(", ")}`
        : "";

    const likelyRootCause =
      cfPlacement && cfPlacement.toLowerCase().startsWith("remote-")
        ? "\n\nLikely root cause: the gateway is running the OpenAI request from a Cloudflare Worker placed in a remote region (see cf-placement). OpenAI blocks some regions, so the gateway must pin placement/egress to a supported region."
        : "";

    return (
      `${providerLabel} refused the request: unsupported country/region.` +
      `${baseUrlHint}` +
      `${placementHint}\n\n` +
      `Fix: switch providers/models, or use a provider/gateway that makes the upstream call from a supported region. If you're using a third-party gateway, they need to fix their placement/egress.` +
      `${likelyRootCause}`
    );
  }

  const statusHint = statusCode ? ` (${statusCode})` : "";
  const detail = message ?? asNonEmptyString((err as { message?: unknown })?.message) ?? null;
  const urlHint = url ? `\nURL: ${url}` : "";
  const detailHint = detail ? `\n\n${detail}` : "";
  return `${providerLabel} request failed${statusHint}.${urlHint}${detailHint}`;
}
