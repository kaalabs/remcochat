import { getOvNlJson, type OvNlClientError } from "@/server/integrations/ov-nl/client";

type QueryValue = string | number | boolean;

export type NsClientConfig = {
  baseUrls: string[];
  timeoutMs: number;
  subscriptionKey: string;
  cacheMaxTtlSeconds: number;
};

export type NsClientResult<T> =
  | { ok: true; payload: T; ttlSeconds: number }
  | { ok: false; error: OvNlClientError };

function clampTtlSeconds(value: number | null | undefined, capSeconds: number): number {
  const cap = Math.max(1, Math.floor(Number(capSeconds ?? 60)));
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return cap;
  return Math.max(1, Math.min(cap, Math.floor(value)));
}

async function nsGetJson(input: {
  cfg: NsClientConfig;
  path: string;
  query?: Record<string, QueryValue | QueryValue[] | null | undefined>;
  headers?: Record<string, string>;
}): Promise<{ ok: true; json: unknown; ttlSeconds: number } | { ok: false; error: OvNlClientError }> {
  const result = await getOvNlJson({
    baseUrls: input.cfg.baseUrls,
    timeoutMs: input.cfg.timeoutMs,
    subscriptionKey: input.cfg.subscriptionKey,
    path: input.path,
    query: input.query,
    headers: input.headers,
  });

  if (!result.ok) return result;
  return {
    ok: true,
    json: result.json,
    ttlSeconds: clampTtlSeconds(result.cacheMaxAgeSeconds, input.cfg.cacheMaxTtlSeconds),
  };
}

function invalidResponse(message: string, details?: Record<string, unknown>): OvNlClientError {
  return {
    code: "upstream_invalid_response",
    message,
    details: details ?? {},
  };
}

export function decodeStationsSearchJson(json: unknown): { ok: true; payload: unknown[] } | { ok: false; error: OvNlClientError } {
  const payload = (json as { payload?: unknown[] } | null)?.payload;
  if (!Array.isArray(payload)) {
    return { ok: false, error: invalidResponse("NS stations response did not include a payload array.") };
  }
  return { ok: true, payload };
}

export async function nsStationsSearch(input: {
  cfg: NsClientConfig;
  query: string;
  limit: number;
  countryCodes?: string[];
}): Promise<NsClientResult<unknown[]>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: "/api/v2/stations",
    query: {
      q: input.query,
      limit: input.limit,
      ...(Array.isArray(input.countryCodes) && input.countryCodes.length > 0
        ? { countryCodes: input.countryCodes.join(",") }
        : {}),
    },
  });
  if (!response.ok) return response;

  const decoded = decodeStationsSearchJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

export function decodeStationsNearestJson(json: unknown): { ok: true; payload: unknown[] } | { ok: false; error: OvNlClientError } {
  const payload = (json as { payload?: unknown[] } | null)?.payload;
  if (!Array.isArray(payload)) {
    return { ok: false, error: invalidResponse("NS nearest stations response did not include a payload array.") };
  }
  return { ok: true, payload };
}

export async function nsStationsNearest(input: {
  cfg: NsClientConfig;
  lat: number;
  lng: number;
  limit: number;
}): Promise<NsClientResult<unknown[]>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: "/api/v2/stations/nearest",
    query: { lat: input.lat, lng: input.lng, limit: input.limit },
  });
  if (!response.ok) return response;

  const decoded = decodeStationsNearestJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

export function decodeDeparturesJson(json: unknown): { ok: true; payload: Record<string, unknown> } | { ok: false; error: OvNlClientError } {
  const payload = (json as { payload?: Record<string, unknown> } | null)?.payload;
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: invalidResponse("NS departures response did not include payload.") };
  }
  return { ok: true, payload };
}

export async function nsDepartures(input: {
  cfg: NsClientConfig;
  lang: string;
  station?: string;
  uicCode?: string;
  dateTime?: string;
  maxJourneys?: number;
}): Promise<NsClientResult<Record<string, unknown>>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: "/api/v2/departures",
    query: {
      lang: input.lang,
      station: input.station,
      uicCode: input.uicCode,
      dateTime: input.dateTime,
      maxJourneys: input.maxJourneys,
    },
  });
  if (!response.ok) return response;

  const decoded = decodeDeparturesJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

export function decodeArrivalsJson(json: unknown): { ok: true; payload: Record<string, unknown> } | { ok: false; error: OvNlClientError } {
  const payload = (json as { payload?: Record<string, unknown> } | null)?.payload;
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: invalidResponse("NS arrivals response did not include payload.") };
  }
  return { ok: true, payload };
}

export async function nsArrivals(input: {
  cfg: NsClientConfig;
  lang: string;
  station?: string;
  uicCode?: string;
  dateTime?: string;
  maxJourneys?: number;
}): Promise<NsClientResult<Record<string, unknown>>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: "/api/v2/arrivals",
    query: {
      lang: input.lang,
      station: input.station,
      uicCode: input.uicCode,
      dateTime: input.dateTime,
      maxJourneys: input.maxJourneys,
    },
  });
  if (!response.ok) return response;

  const decoded = decodeArrivalsJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

function extractTripsAdviceList(raw: unknown): Array<Record<string, unknown>> {
  const hasTripsArray = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).trips));

  if (Array.isArray(raw)) {
    return raw.filter(hasTripsArray);
  }

  if (raw && typeof raw === "object") {
    const root = raw as Record<string, unknown>;
    const candidates: unknown[] = [root];

    const payload = root.payload;
    if (Array.isArray(payload)) {
      candidates.push(...payload);
    } else if (payload && typeof payload === "object") {
      candidates.push(payload);
    }

    return candidates.filter(hasTripsArray);
  }

  return [];
}

export function decodeTripsJson(json: unknown): { ok: true; payload: Array<Record<string, unknown>> } | { ok: false; error: OvNlClientError } {
  const advices = extractTripsAdviceList(json);
  if (advices.length === 0) {
    return { ok: false, error: invalidResponse("NS trips response is not in a supported format.") };
  }
  return { ok: true, payload: advices };
}

export async function nsTripsSearch(input: {
  cfg: NsClientConfig;
  lang: string;
  fromStation: string;
  toStation: string;
  viaStation?: string;
  dateTime?: string;
  searchForArrival?: boolean;
}): Promise<NsClientResult<Array<Record<string, unknown>>>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: "/api/v3/trips",
    query: {
      lang: input.lang,
      fromStation: input.fromStation,
      toStation: input.toStation,
      viaStation: input.viaStation,
      dateTime: input.dateTime,
      searchForArrival: input.searchForArrival,
    },
  });
  if (!response.ok) return response;

  const decoded = decodeTripsJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

export function decodeTripDetailJson(json: unknown): { ok: true; payload: Record<string, unknown> } | { ok: false; error: OvNlClientError } {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, error: invalidResponse("NS trip detail response is not an object.") };
  }
  return { ok: true, payload: json as Record<string, unknown> };
}

export async function nsTripDetail(input: {
  cfg: NsClientConfig;
  ctxRecon: string;
  date?: string;
  lang: string;
}): Promise<NsClientResult<Record<string, unknown>>> {
  const trimmedDate = typeof input.date === "string" ? input.date.trim() : "";
  const dateOnlyCandidate =
    trimmedDate && /^\d{4}-\d{2}-\d{2}t/i.test(trimmedDate) ? trimmedDate.slice(0, 10) : "";

  const tryFetch = async (
    date: string | undefined
  ): Promise<{ ok: true; json: unknown; ttlSeconds: number } | { ok: false; error: OvNlClientError }> =>
    nsGetJson({
      cfg: input.cfg,
      path: "/api/v3/trips/trip",
      query: {
        ctxRecon: input.ctxRecon,
        ...(date ? { date } : {}),
        lang: input.lang,
      },
      headers: {
        "Accept-Language": input.lang,
        lang: input.lang,
      },
    });

  const candidates: Array<string | undefined> = [];
  if (trimmedDate) candidates.push(trimmedDate);
  if (dateOnlyCandidate && dateOnlyCandidate !== trimmedDate) candidates.push(dateOnlyCandidate);
  candidates.push(undefined);

  let response = await tryFetch(candidates[0]);
  for (let i = 1; i < candidates.length; i += 1) {
    if (response.ok) break;
    if (!trimmedDate) break;

    const status = response.error.status;
    // Retry only when upstream explicitly rejects the date parameter (bad request).
    // Treat 404 as terminal to avoid extra calls for invalid/expired ctxRecon values.
    const canRetry = response.error.code === "upstream_http_error" && status === 400;
    if (!canRetry) break;

    response = await tryFetch(candidates[i]);
  }

  if (!response.ok) return response;
  const decoded = decodeTripDetailJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

export function decodeJourneyDetailJson(json: unknown): { ok: true; payload: Record<string, unknown> } | { ok: false; error: OvNlClientError } {
  const payload = (json as { payload?: unknown } | null)?.payload;
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: invalidResponse("NS journey detail response did not include payload.") };
  }
  return { ok: true, payload: payload as Record<string, unknown> };
}

export async function nsJourneyDetail(input: {
  cfg: NsClientConfig;
  id?: string;
  train?: number;
  dateTime?: string;
  departureUicCode?: string;
  transferUicCode?: string;
  arrivalUicCode?: string;
  omitCrowdForecast?: boolean;
}): Promise<NsClientResult<Record<string, unknown>>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: "/api/v2/journey",
    query: {
      id: input.id,
      train: input.train,
      dateTime: input.dateTime,
      departureUicCode: input.departureUicCode,
      transferUicCode: input.transferUicCode,
      arrivalUicCode: input.arrivalUicCode,
      omitCrowdForecast: input.omitCrowdForecast,
    },
  });
  if (!response.ok) return response;
  const decoded = decodeJourneyDetailJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

export function decodeDisruptionsListJson(json: unknown): { ok: true; payload: unknown[] } | { ok: false; error: OvNlClientError } {
  if (!Array.isArray(json)) return { ok: false, error: invalidResponse("NS disruptions response is not an array.") };
  return { ok: true, payload: json };
}

export async function nsDisruptions(input: {
  cfg: NsClientConfig;
  type?: string[] | string;
  isActive?: boolean;
  acceptLanguage?: string;
}): Promise<NsClientResult<unknown[]>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: "/api/v3/disruptions",
    query: {
      type: input.type,
      isActive: input.isActive,
    },
    headers: input.acceptLanguage ? { "Accept-Language": input.acceptLanguage } : undefined,
  });
  if (!response.ok) return response;
  const decoded = decodeDisruptionsListJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

export function decodeDisruptionsByStationJson(json: unknown): { ok: true; payload: unknown[] } | { ok: false; error: OvNlClientError } {
  if (!Array.isArray(json)) {
    return { ok: false, error: invalidResponse("NS station disruptions response is not an array.") };
  }
  return { ok: true, payload: json };
}

export async function nsDisruptionsByStation(input: {
  cfg: NsClientConfig;
  stationCode: string;
}): Promise<NsClientResult<unknown[]>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: `/api/v3/disruptions/station/${encodeURIComponent(input.stationCode)}`,
  });
  if (!response.ok) return response;
  const decoded = decodeDisruptionsByStationJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}

export function decodeDisruptionDetailJson(json: unknown): { ok: true; payload: Record<string, unknown> } | { ok: false; error: OvNlClientError } {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, error: invalidResponse("NS disruption detail response is not an object.") };
  }
  return { ok: true, payload: json as Record<string, unknown> };
}

export async function nsDisruptionDetail(input: {
  cfg: NsClientConfig;
  type: string;
  id: string;
}): Promise<NsClientResult<Record<string, unknown>>> {
  const response = await nsGetJson({
    cfg: input.cfg,
    path: `/api/v3/disruptions/${encodeURIComponent(input.type)}/${encodeURIComponent(input.id)}`,
  });
  if (!response.ok) return response;
  const decoded = decodeDisruptionDetailJson(response.json);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, payload: decoded.payload, ttlSeconds: response.ttlSeconds };
}
