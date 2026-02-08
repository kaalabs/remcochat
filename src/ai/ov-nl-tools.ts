import { tool as createTool } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { logEvent } from "@/server/log";
import { isLocalhostRequest, isRequestAllowedByAdminPolicy } from "@/server/request-auth";
import { getOvNlJson, type OvNlClientError } from "@/server/integrations/ov-nl/client";
import type {
  OvNlArrival,
  OvNlDeparture,
  OvNlDisambiguationCandidate,
  OvNlDisruption,
  OvNlErrorCode,
  OvNlStation,
  OvNlToolAction,
  OvNlToolError,
  OvNlToolOutput,
  OvNlTripLeg,
  OvNlTripLegStop,
  OvNlTripSummary,
} from "@/lib/types";

export type OvNlGatewayToolsResult = {
  enabled: boolean;
  tools: Record<string, unknown>;
};

const OV_NL_ACTIONS = [
  "stations.search",
  "stations.nearest",
  "departures.list",
  "departures.window",
  "arrivals.list",
  "trips.search",
  "trips.detail",
  "journey.detail",
  "disruptions.list",
  "disruptions.by_station",
  "disruptions.detail",
] as const;

const OvNlGatewayToolActionSchema = z.enum(OV_NL_ACTIONS);

const StationCodeSchema = z.string().trim().min(1).max(32);
const UicCodeSchema = z.string().trim().min(1).max(32);
const DateTimeInputSchema = z.string().trim().min(1).max(64);
const LooseString = (max: number) => z.string().max(max).optional();

const StationsSearchArgsSchema = z
  .object({
    query: z.string().trim().min(2).max(120),
    limit: z.number().int().min(1).max(30).optional(),
    countryCodes: z.array(z.string().trim().min(1).max(8)).max(8).optional(),
  })
  .strip();

const StationsNearestArgsSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strip()
  .refine(
    (v) =>
      typeof (v.latitude ?? v.lat) === "number" &&
      typeof (v.longitude ?? v.lng) === "number",
    "stations.nearest requires latitude/longitude or lat/lng"
  );

const DeparturesListArgsSchema = z
  .object({
    station: z.string().trim().min(1).max(120).optional(),
    stationCode: StationCodeSchema.optional(),
    uicCode: UicCodeSchema.optional(),
    dateTime: DateTimeInputSchema.optional(),
    maxJourneys: z.number().int().min(1).max(200).optional(),
    lang: z.string().trim().min(2).max(12).optional(),
  })
  .strip()
  .refine(
    (v) => Boolean(v.station || v.stationCode || v.uicCode),
    "departures.list requires station, stationCode, or uicCode"
  );

const DeparturesWindowArgsSchema = z
  .object({
    station: z.string().trim().min(1).max(120).optional(),
    stationCode: StationCodeSchema.optional(),
    uicCode: UicCodeSchema.optional(),
    date: z.string().trim().min(1).max(32).optional(),
    fromTime: z.string().trim().min(1).max(16).optional(),
    toTime: z.string().trim().min(1).max(16).optional(),
    fromDateTime: DateTimeInputSchema.optional(),
    toDateTime: DateTimeInputSchema.optional(),
    maxJourneys: z.number().int().min(1).max(200).optional(),
    lang: z.string().trim().min(2).max(12).optional(),
  })
  .strip()
  .refine(
    (v) => Boolean(v.station || v.stationCode || v.uicCode),
    "departures.window requires station, stationCode, or uicCode"
  )
  .refine(
    (v) => Boolean((v.fromDateTime && v.toDateTime) || (v.fromTime && v.toTime)),
    "departures.window requires fromDateTime+toDateTime or fromTime+toTime"
  );

const ArrivalsListArgsSchema = z
  .object({
    station: z.string().trim().min(1).max(120).optional(),
    stationCode: StationCodeSchema.optional(),
    uicCode: UicCodeSchema.optional(),
    dateTime: DateTimeInputSchema.optional(),
    maxJourneys: z.number().int().min(1).max(200).optional(),
    lang: z.string().trim().min(2).max(12).optional(),
  })
  .strip()
  .refine(
    (v) => Boolean(v.station || v.stationCode || v.uicCode),
    "arrivals.list requires station, stationCode, or uicCode"
  );

const TripsSearchArgsSchema = z
  .object({
    from: z.string().trim().min(1).max(120),
    to: z.string().trim().min(1).max(120),
    via: z.string().trim().min(1).max(120).optional(),
    dateTime: DateTimeInputSchema.optional(),
    searchForArrival: z.boolean().optional(),
    limit: z.number().int().min(1).max(20).optional(),
    lang: z.string().trim().min(2).max(12).optional(),
  })
  .strip();

const TripsDetailArgsSchema = z
  .object({
    ctxRecon: z.string().trim().min(1).max(4000),
    date: DateTimeInputSchema.optional(),
    lang: z.string().trim().min(2).max(12).optional(),
  })
  .strip();

const JourneyDetailArgsSchema = z
  .object({
    id: z.string().trim().min(1).max(4000).optional(),
    train: z.number().int().min(1).max(99_999).optional(),
    dateTime: DateTimeInputSchema.optional(),
    departureUicCode: UicCodeSchema.optional(),
    transferUicCode: UicCodeSchema.optional(),
    arrivalUicCode: UicCodeSchema.optional(),
    omitCrowdForecast: z.boolean().optional(),
  })
  .strip()
  .refine((v) => Boolean(v.id || v.train), "journey.detail requires id or train");

const DisruptionsListArgsSchema = z
  .object({
    type: z
      .array(z.enum(["CALAMITY", "DISRUPTION", "MAINTENANCE"]))
      .max(3)
      .optional(),
    isActive: z.boolean().optional(),
    lang: z.string().trim().min(2).max(64).optional(),
  })
  .strip();

const DisruptionsByStationArgsSchema = z
  .object({
    station: z.string().trim().min(1).max(120),
  })
  .strip();

const DisruptionsDetailArgsSchema = z
  .object({
    type: z.enum(["CALAMITY", "DISRUPTION", "MAINTENANCE"]),
    id: z.string().trim().min(1).max(120),
  })
  .strip();

const OvNlGatewayToolWireArgsSchema = z
  .object({
    query: LooseString(120),
    limit: z.number().int().min(1).max(80).optional(),
    countryCodes: z.array(z.string().max(8)).max(8).optional(),

    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),

    station: LooseString(120),
    stationCode: LooseString(32),
    uicCode: LooseString(32),
    dateTime: LooseString(64),
    fromDateTime: LooseString(64),
    toDateTime: LooseString(64),
    fromTime: LooseString(16),
    toTime: LooseString(16),
    maxJourneys: z.number().int().min(1).max(200).optional(),
    lang: LooseString(64),

    from: LooseString(120),
    to: LooseString(120),
    via: LooseString(120),
    searchForArrival: z.boolean().optional(),
    date: LooseString(64),
    ctxRecon: LooseString(4000),

    id: LooseString(4000),
    train: z.number().int().min(1).max(99_999).optional(),
    departureUicCode: LooseString(32),
    transferUicCode: LooseString(32),
    arrivalUicCode: LooseString(32),
    omitCrowdForecast: z.boolean().optional(),

    type: z
      .union([
        z.enum(["CALAMITY", "DISRUPTION", "MAINTENANCE"]),
        z.array(z.enum(["CALAMITY", "DISRUPTION", "MAINTENANCE"])).max(3),
      ])
      .optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();

const OvNlGatewayToolWireInputSchema = z
  .object({
    action: OvNlGatewayToolActionSchema,
    args: OvNlGatewayToolWireArgsSchema.optional(),
  })
  .passthrough();

const OvNlGatewayToolValidatedInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stations.search"), args: StationsSearchArgsSchema }).strict(),
  z.object({ action: z.literal("stations.nearest"), args: StationsNearestArgsSchema }).strict(),
  z.object({ action: z.literal("departures.list"), args: DeparturesListArgsSchema }).strict(),
  z.object({ action: z.literal("departures.window"), args: DeparturesWindowArgsSchema }).strict(),
  z.object({ action: z.literal("arrivals.list"), args: ArrivalsListArgsSchema }).strict(),
  z.object({ action: z.literal("trips.search"), args: TripsSearchArgsSchema }).strict(),
  z.object({ action: z.literal("trips.detail"), args: TripsDetailArgsSchema }).strict(),
  z.object({ action: z.literal("journey.detail"), args: JourneyDetailArgsSchema }).strict(),
  z.object({ action: z.literal("disruptions.list"), args: DisruptionsListArgsSchema }).strict(),
  z
    .object({
      action: z.literal("disruptions.by_station"),
      args: DisruptionsByStationArgsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("disruptions.detail"),
      args: DisruptionsDetailArgsSchema,
    })
    .strict(),
]);

type OvNlActionExecutionContext = {
  cfg: NonNullable<ReturnType<typeof getConfig>["ovNl"]>;
  subscriptionKey: string;
  ttlHints: number[];
};

type OvNlStationResolution =
  | { kind: "resolved"; station: OvNlStation }
  | { kind: "disambiguation"; query: string; candidates: OvNlDisambiguationCandidate[] }
  | { kind: "error"; error: OvNlToolError };

type OvNlActionExecutionResult = {
  output: OvNlToolOutput;
  cacheTtlSeconds: number | null;
};

type CacheEntry = {
  expiresAtMs: number;
  output: OvNlToolOutput;
};

const ovNlCache = new Map<string, CacheEntry>();

function clampTtlSeconds(value: number | null | undefined, capSeconds: number): number {
  const cap = Math.max(1, Math.floor(Number(capSeconds ?? 60)));
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return cap;
  return Math.max(1, Math.min(cap, Math.floor(value)));
}

function pickActionTtlSeconds(capSeconds: number, hints: number[]): number {
  const cleaned = hints.filter((value) => Number.isFinite(value) && value > 0);
  if (cleaned.length === 0) return clampTtlSeconds(null, capSeconds);
  return clampTtlSeconds(Math.min(...cleaned), capSeconds);
}

function stableNormalize(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => stableNormalize(item));
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner === undefined) continue;
      out[key] = stableNormalize(inner);
    }
    return out;
  }
  return null;
}

function makeCacheKey(action: OvNlToolAction, args: unknown) {
  return JSON.stringify({
    action,
    args: stableNormalize(args),
  });
}

function sanitizeLooseToolArgs(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => sanitizeLooseToolArgs(item))
      .filter((item) => item !== undefined);
    return cleaned;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = sanitizeLooseToolArgs(inner);
      if (cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return out;
  }
  return value;
}

function getCachedOutput(cacheKey: string): OvNlToolOutput | null {
  const now = Date.now();
  const entry = ovNlCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAtMs <= now) {
    ovNlCache.delete(cacheKey);
    return null;
  }

  const cloned = structuredClone(entry.output);
  cloned.cached = true;
  return cloned;
}

function setCachedOutput(cacheKey: string, output: OvNlToolOutput, ttlSeconds: number) {
  const ttl = Math.max(1, Math.floor(Number(ttlSeconds ?? 1)));
  ovNlCache.set(cacheKey, {
    output: structuredClone(output),
    expiresAtMs: Date.now() + ttl * 1000,
  });
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNullableText(value: unknown): string | null {
  const v = asText(value);
  return v ? v : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLanguage(value: unknown): string {
  const trimmed = asText(value).toLowerCase();
  if (!trimmed) return "nl";
  if (trimmed === "nl" || trimmed.startsWith("nl-")) return "nl";
  if (trimmed === "en" || trimmed.startsWith("en-")) return "en";
  return trimmed;
}

function normalizeDateTimeInput(value: unknown, nowMs = Date.now()): string | undefined {
  const trimmed = asText(value);
  if (!trimmed) return undefined;

  const base = new Date(nowMs);
  const normalized = trimmed.toLowerCase();
  if (normalized === "now" || normalized === "nu" || normalized === "today" || normalized === "vandaag") {
    return base.toISOString();
  }
  if (normalized === "tomorrow" || normalized === "morgen") {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (normalized === "yesterday" || normalized === "gisteren") {
    const d = new Date(nowMs);
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  }

  return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed;
}

const OV_NL_TIME_ZONE = "Europe/Amsterdam";

function parseIsoDateInput(value: unknown): { year: number; month: number; day: number } | null {
  const trimmed = asText(value);
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseLocalTimeInput(value: unknown): { hour: number; minute: number } | null {
  const trimmed = asText(value);
  if (!trimmed) return null;
  const normalized = trimmed.replace(".", ":");
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function addDaysToDateParts(
  date: { year: number; month: number; day: number },
  days: number
): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + Math.floor(days));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function timeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const date = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "NaN");

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return 0;
  }

  const zonedAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return zonedAsUtcMs - utcMs;
}

function zonedLocalDateTimeToUtcMs(input: {
  timeZone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}): number {
  const second = Math.max(0, Math.min(59, Math.floor(Number(input.second ?? 0))));
  const naiveUtcMs = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, second);
  let candidateMs = naiveUtcMs - timeZoneOffsetMs(input.timeZone, naiveUtcMs);
  // Second pass handles DST boundaries.
  candidateMs = naiveUtcMs - timeZoneOffsetMs(input.timeZone, candidateMs);
  return candidateMs;
}

function currentDatePartsInTimeZone(
  timeZone: string,
  nowMs: number
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));

  const year = Number(parts.find((p) => p.type === "year")?.value ?? "NaN");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "NaN");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "NaN");
  return {
    year: Number.isFinite(year) ? year : new Date(nowMs).getUTCFullYear(),
    month: Number.isFinite(month) ? month : new Date(nowMs).getUTCMonth() + 1,
    day: Number.isFinite(day) ? day : new Date(nowMs).getUTCDate(),
  };
}

function resolveDepartureWindowOrError(input: {
  args: {
    date?: string;
    fromTime?: string;
    toTime?: string;
    fromDateTime?: string;
    toDateTime?: string;
  };
  nowMs: number;
}):
  | {
      ok: true;
      fromMs: number;
      toMs: number;
      fromIso: string;
      toIso: string;
    }
  | { ok: false; error: OvNlToolError } {
  const requestedFrom = normalizeDateTimeInput(input.args.fromDateTime, input.nowMs);
  const requestedTo = normalizeDateTimeInput(input.args.toDateTime, input.nowMs);
  if (requestedFrom && requestedTo) {
    const fromMs = Date.parse(requestedFrom);
    const toMs = Date.parse(requestedTo);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return {
        ok: false,
        error: {
          code: "invalid_tool_input",
          message: "departures.window requires valid ISO date/time inputs.",
        },
      };
    }
    if (toMs <= fromMs) {
      return {
        ok: false,
        error: {
          code: "invalid_tool_input",
          message: "departures.window requires toDateTime to be after fromDateTime.",
        },
      };
    }
    return {
      ok: true,
      fromMs,
      toMs,
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date(toMs).toISOString(),
    };
  }

  const fromTime = parseLocalTimeInput(input.args.fromTime);
  const toTime = parseLocalTimeInput(input.args.toTime);
  if (!fromTime || !toTime) {
    return {
      ok: false,
      error: {
        code: "invalid_tool_input",
        message: 'departures.window requires fromTime/toTime in "HH:MM" format when ISO datetimes are not provided.',
      },
    };
  }

  const dateParts =
    parseIsoDateInput(input.args.date) ??
    currentDatePartsInTimeZone(OV_NL_TIME_ZONE, input.nowMs);

  const fromMs = zonedLocalDateTimeToUtcMs({
    timeZone: OV_NL_TIME_ZONE,
    ...dateParts,
    ...fromTime,
  });

  let toDateParts = dateParts;
  const fromTotalMinutes = fromTime.hour * 60 + fromTime.minute;
  const toTotalMinutes = toTime.hour * 60 + toTime.minute;
  if (toTotalMinutes <= fromTotalMinutes) {
    toDateParts = addDaysToDateParts(dateParts, 1);
  }

  const toMs = zonedLocalDateTimeToUtcMs({
    timeZone: OV_NL_TIME_ZONE,
    ...toDateParts,
    ...toTime,
  });

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return {
      ok: false,
      error: {
        code: "invalid_tool_input",
        message: "departures.window could not resolve a valid time window.",
      },
    };
  }

  return {
    ok: true,
    fromMs,
    toMs,
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
  };
}

const TRIPS_SEARCH_FUTURE_GRACE_MS = 2 * 60 * 1000;

function coerceTripsSearchDateTimeToNowIfPast(input: {
  requested: string | undefined;
  nowMs: number;
}): string {
  const nowIso = new Date(input.nowMs).toISOString();
  if (!input.requested) return nowIso;
  const parsedMs = Date.parse(input.requested);
  if (!Number.isFinite(parsedMs)) return nowIso;
  if (parsedMs < input.nowMs - TRIPS_SEARCH_FUTURE_GRACE_MS) return nowIso;
  return input.requested;
}

function filterDepartedTrips(trips: OvNlTripSummary[], nowMs: number): OvNlTripSummary[] {
  const cutoffMs = nowMs - TRIPS_SEARCH_FUTURE_GRACE_MS;
  return trips.filter((trip) => {
    const dt = trip.departureActualDateTime || trip.departurePlannedDateTime;
    if (!dt) return true;
    const parsed = Date.parse(dt);
    if (!Number.isFinite(parsed)) return true;
    return parsed >= cutoffMs;
  });
}

function stationDisplayName(station: OvNlStation): string {
  return station.nameLong || station.nameMedium || station.nameShort || station.code;
}

function normalizeStation(raw: unknown): OvNlStation {
  const station = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const names = station.namen as
    | { kort?: unknown; middel?: unknown; lang?: unknown }
    | undefined;

  const code = asText(station.code).toUpperCase();
  const uicCode =
    asText(station.UICCode) ||
    asText(station.uicCode) ||
    asText(station.uicCdCode) ||
    asText(station.UICCdCode);

  const shortName = asText(names?.kort) || code || uicCode;
  const mediumName = asText(names?.middel) || shortName;
  const longName = asText(names?.lang) || mediumName;

  return {
    code: code || shortName.toUpperCase(),
    uicCode: uicCode || "",
    nameShort: shortName,
    nameMedium: mediumName,
    nameLong: longName,
    countryCode: asText(station.land).toUpperCase(),
    lat: asNumberOrNull(station.lat),
    lng: asNumberOrNull(station.lng),
    distanceMeters: asNumberOrNull(station.distance),
  };
}

function tokenizeComparable(value: string): string[] {
  return normalizeComparable(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function isCenterToken(token: string): boolean {
  return token === "c" || token.startsWith("centr") || token.startsWith("centrum");
}

function looselyMatchesStationToken(queryToken: string, stationToken: string): boolean {
  const q = asText(queryToken);
  const s = asText(stationToken);
  if (!q || !s) return false;
  if (q === s) return true;
  if (q.length >= 3 && s.startsWith(q)) return true;
  if (s.length >= 3 && q.startsWith(s)) return true;
  if (isCenterToken(q) && isCenterToken(s)) return true;
  return false;
}

function stationTokenCoverage(station: OvNlStation, query: string): number {
  const queryTokens = tokenizeComparable(query);
  if (queryTokens.length === 0) return 0;

  let best = 0;
  for (const variant of stationNameVariants(station)) {
    const stationTokens = tokenizeComparable(variant);
    if (stationTokens.length === 0) continue;

    let matched = 0;
    for (const queryToken of queryTokens) {
      if (stationTokens.some((stationToken) => looselyMatchesStationToken(queryToken, stationToken))) {
        matched += 1;
      }
    }

    best = Math.max(best, matched / queryTokens.length);
  }

  return best;
}

function stationFirstTokenMatches(station: OvNlStation, query: string): boolean {
  const firstQueryToken = tokenizeComparable(query)[0];
  if (!firstQueryToken) return false;

  return stationNameVariants(station).some((variant) => {
    const stationFirstToken = tokenizeComparable(variant)[0];
    if (!stationFirstToken) return false;
    return looselyMatchesStationToken(firstQueryToken, stationFirstToken);
  });
}

function scoreStationCandidate(station: OvNlStation, query: string): number {
  const normalizedQuery = normalizeComparable(query);
  const queryUpper = asText(query).toUpperCase();
  if (!normalizedQuery) return 0;

  const names = [station.nameShort, station.nameMedium, station.nameLong]
    .map((name) => normalizeComparable(name))
    .filter(Boolean);
  const code = station.code.toUpperCase();
  const uic = station.uicCode;

  if (queryUpper && code && code === queryUpper) return 1;
  if (query && uic && uic === query) return 0.99;
  if (names.some((name) => name === normalizedQuery)) return 0.98;
  if (names.some((name) => name.startsWith(normalizedQuery))) return 0.9;
  const tokenCoverage = stationTokenCoverage(station, query);
  const firstTokenMatch = stationFirstTokenMatches(station, query);
  if (firstTokenMatch && tokenCoverage >= 0.99) return 0.97;
  if (firstTokenMatch && tokenCoverage >= 0.75) return 0.92;
  if (tokenCoverage >= 0.75) return 0.84;
  if (firstTokenMatch && tokenCoverage >= 0.5) return 0.76;
  if (tokenCoverage >= 0.5) return 0.68;
  if (names.some((name) => name.includes(normalizedQuery))) return 0.75;
  if (code && code.startsWith(queryUpper)) return 0.7;
  return 0.4;
}

function stationNameVariants(station: OvNlStation): string[] {
  return [station.nameShort, station.nameMedium, station.nameLong]
    .map((name) => normalizeComparable(name))
    .filter(Boolean);
}

function extractStationCodeOrUicCandidate(query: string): {
  stationCode?: string;
  uicCode?: string;
} {
  const trimmed = asText(query);
  if (!trimmed) return {};

  const compact = trimmed.toUpperCase().replace(/\s+/g, "");
  if (/^\d{6,9}$/.test(compact)) return { uicCode: compact };
  if (/^[A-Z]{2,6}$/.test(compact)) return { stationCode: compact };

  const stationCodeMatch = trimmed.toUpperCase().match(/\(([A-Z]{2,6})\)/);
  if (stationCodeMatch?.[1]) return { stationCode: stationCodeMatch[1] };

  const uicMatch = trimmed.match(/\b(\d{6,9})\b/);
  if (uicMatch?.[1]) return { uicCode: uicMatch[1] };

  return {};
}

function normalizeMessages(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      const item =
        message && typeof message === "object"
          ? (message as Record<string, unknown>)
          : {};
      const pieces = [asText(item.head), asText(item.text), asText(item.lead)].filter(Boolean);
      if (pieces.length === 0) return "";
      return pieces.join(" - ");
    })
    .filter(Boolean);
}

function normalizeDeparture(raw: unknown, index: number): OvNlDeparture {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const product =
    item.product && typeof item.product === "object"
      ? (item.product as Record<string, unknown>)
      : {};

  const plannedDateTime = asText(item.plannedDateTime);
  const actualDateTime = asNullableText(item.actualDateTime);
  const journeyDetailRef = asNullableText(item.journeyDetailRef);
  const trainNumber = asText(product.number);
  const destination = asText(item.direction) || asText(item.name);

  return {
    id: journeyDetailRef || `${plannedDateTime || "departure"}-${index}`,
    destination,
    plannedDateTime,
    actualDateTime,
    plannedTrack: asNullableText(item.plannedTrack),
    actualTrack: asNullableText(item.actualTrack),
    status: asText(item.departureStatus) || "UNKNOWN",
    cancelled: asBoolean(item.cancelled),
    trainCategory: asText(item.trainCategory),
    trainNumber,
    operatorName: asNullableText(product.operatorName),
    crowdForecast: null,
    messages: normalizeMessages(item.messages),
    journeyDetailRef,
  };
}

function normalizeArrival(raw: unknown, index: number): OvNlArrival {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const product =
    item.product && typeof item.product === "object"
      ? (item.product as Record<string, unknown>)
      : {};

  const plannedDateTime = asText(item.plannedDateTime);
  const actualDateTime = asNullableText(item.actualDateTime);
  const journeyDetailRef = asNullableText(item.journeyDetailRef);
  const trainNumber = asText(product.number);

  return {
    id: journeyDetailRef || `${plannedDateTime || "arrival"}-${index}`,
    origin: asText(item.origin) || asText(item.name),
    plannedDateTime,
    actualDateTime,
    plannedTrack: asNullableText(item.plannedTrack),
    actualTrack: asNullableText(item.actualTrack),
    status: asText(item.arrivalStatus) || "UNKNOWN",
    cancelled: asBoolean(item.cancelled),
    trainCategory: asText(item.trainCategory),
    trainNumber,
    operatorName: asNullableText(product.operatorName),
    crowdForecast: null,
    messages: normalizeMessages(item.messages),
    journeyDetailRef,
  };
}

function toKnownTravelType(value: unknown): OvNlTripLeg["mode"] {
  const v = asText(value).toUpperCase();
  if (
    v === "PUBLIC_TRANSIT" ||
    v === "WALK" ||
    v === "TRANSFER" ||
    v === "BIKE" ||
    v === "CAR" ||
    v === "KISS" ||
    v === "TAXI"
  ) {
    return v;
  }
  return "UNKNOWN";
}

function normalizeTripLegStop(raw: unknown): OvNlTripLegStop {
  const stop = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const arrivalsRaw = Array.isArray(stop.arrivals) ? stop.arrivals : [];
  const departuresRaw = Array.isArray(stop.departures) ? stop.departures : [];
  const arrival0 =
    arrivalsRaw[0] && typeof arrivalsRaw[0] === "object"
      ? (arrivalsRaw[0] as Record<string, unknown>)
      : {};
  const departure0 =
    departuresRaw[0] && typeof departuresRaw[0] === "object"
      ? (departuresRaw[0] as Record<string, unknown>)
      : {};

  const pickLooseScalarText = (value: unknown): string | null => {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const picked = pickLooseScalarText(item);
        if (picked) return picked;
      }
      return null;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const keys = [
        "track",
        "platform",
        "spoor",
        "trackNumber",
        "platformNumber",
        "spoorNumber",
        "trackNo",
        "platformNo",
        "spoorNo",
        "number",
        "value",
        "label",
        "name",
        "code",
      ];
      for (const key of keys) {
        const picked = pickLooseScalarText(obj[key]);
        if (picked) return picked;
      }
    }
    return null;
  };

  const nestedStop =
    stop.stop && typeof stop.stop === "object" ? (stop.stop as Record<string, unknown>) : {};

  const name =
    asText(stop.name) ||
    asText(stop.stationName) ||
    asText(stop.locationName) ||
    asText(nestedStop.name) ||
    asText(nestedStop.rawLocationName) ||
    asText(stop.rawLocationName) ||
    "Stop";

  const plannedDateTime =
    asNullableText(stop.plannedDateTime) ||
    asNullableText(stop.plannedDepartureDateTime) ||
    asNullableText(stop.plannedArrivalDateTime) ||
    asNullableText(stop.plannedTime) ||
    asNullableText(arrival0.plannedDateTime) ||
    asNullableText(arrival0.plannedTime) ||
    asNullableText(departure0.plannedDateTime) ||
    asNullableText(departure0.plannedTime);

  const actualDateTime =
    asNullableText(stop.actualDateTime) ||
    asNullableText(stop.actualDepartureDateTime) ||
    asNullableText(stop.actualArrivalDateTime) ||
    asNullableText(stop.actualTime) ||
    asNullableText(arrival0.actualDateTime) ||
    asNullableText(arrival0.actualTime) ||
    asNullableText(departure0.actualDateTime) ||
    asNullableText(departure0.actualTime);

  const plannedTrack =
    pickLooseScalarText(stop.plannedTrack) ||
    pickLooseScalarText(stop.plannedArrivalTrack) ||
    pickLooseScalarText(stop.plannedArrivalPlatform) ||
    pickLooseScalarText(stop.plannedArrivalSpoor) ||
    pickLooseScalarText(stop.plannedDepartureTrack) ||
    pickLooseScalarText(stop.plannedDeparturePlatform) ||
    pickLooseScalarText(stop.plannedDepartureSpoor) ||
    pickLooseScalarText(stop.plannedPlatform) ||
    pickLooseScalarText(stop.plannedSpoor) ||
    pickLooseScalarText(stop.platform) ||
    pickLooseScalarText(stop.spoor) ||
    pickLooseScalarText(stop.track) ||
    pickLooseScalarText(stop.arrivalTrack) ||
    pickLooseScalarText(stop.arrivalPlatform) ||
    pickLooseScalarText(stop.arrivalSpoor) ||
    pickLooseScalarText(stop.departureTrack) ||
    pickLooseScalarText(stop.departurePlatform) ||
    pickLooseScalarText(stop.departureSpoor) ||
    pickLooseScalarText(arrival0.plannedTrack) ||
    pickLooseScalarText(arrival0.plannedPlatform) ||
    pickLooseScalarText(arrival0.plannedSpoor) ||
    pickLooseScalarText(arrival0.plannedArrivalTrack) ||
    pickLooseScalarText(arrival0.plannedArrivalPlatform) ||
    pickLooseScalarText(arrival0.plannedArrivalSpoor) ||
    pickLooseScalarText(arrival0.plannedDepartureTrack) ||
    pickLooseScalarText(arrival0.plannedDeparturePlatform) ||
    pickLooseScalarText(arrival0.plannedDepartureSpoor) ||
    pickLooseScalarText(arrival0.platform) ||
    pickLooseScalarText(arrival0.spoor) ||
    pickLooseScalarText(arrival0.track) ||
    pickLooseScalarText(arrival0.arrivalTrack) ||
    pickLooseScalarText(arrival0.arrivalPlatform) ||
    pickLooseScalarText(arrival0.arrivalSpoor) ||
    pickLooseScalarText(arrival0.departureTrack) ||
    pickLooseScalarText(arrival0.departurePlatform) ||
    pickLooseScalarText(arrival0.departureSpoor) ||
    pickLooseScalarText(departure0.plannedTrack) ||
    pickLooseScalarText(departure0.plannedPlatform) ||
    pickLooseScalarText(departure0.plannedSpoor) ||
    pickLooseScalarText(departure0.plannedArrivalTrack) ||
    pickLooseScalarText(departure0.plannedArrivalPlatform) ||
    pickLooseScalarText(departure0.plannedArrivalSpoor) ||
    pickLooseScalarText(departure0.plannedDepartureTrack) ||
    pickLooseScalarText(departure0.plannedDeparturePlatform) ||
    pickLooseScalarText(departure0.plannedDepartureSpoor) ||
    pickLooseScalarText(departure0.platform) ||
    pickLooseScalarText(departure0.spoor) ||
    pickLooseScalarText(departure0.track) ||
    pickLooseScalarText(departure0.arrivalTrack) ||
    pickLooseScalarText(departure0.arrivalPlatform) ||
    pickLooseScalarText(departure0.arrivalSpoor) ||
    pickLooseScalarText(departure0.departureTrack) ||
    pickLooseScalarText(departure0.departurePlatform) ||
    pickLooseScalarText(departure0.departureSpoor);

  const actualTrack =
    pickLooseScalarText(stop.actualTrack) ||
    pickLooseScalarText(stop.actualArrivalTrack) ||
    pickLooseScalarText(stop.actualArrivalPlatform) ||
    pickLooseScalarText(stop.actualArrivalSpoor) ||
    pickLooseScalarText(stop.actualDepartureTrack) ||
    pickLooseScalarText(stop.actualDeparturePlatform) ||
    pickLooseScalarText(stop.actualDepartureSpoor) ||
    pickLooseScalarText(stop.actualPlatform) ||
    pickLooseScalarText(stop.actualSpoor) ||
    pickLooseScalarText(stop.track) ||
    pickLooseScalarText(stop.platform) || // fallback if provider only emits platform
    pickLooseScalarText(stop.spoor) ||
    pickLooseScalarText(stop.arrivalTrack) ||
    pickLooseScalarText(stop.arrivalPlatform) ||
    pickLooseScalarText(stop.arrivalSpoor) ||
    pickLooseScalarText(stop.departureTrack) ||
    pickLooseScalarText(stop.departurePlatform) ||
    pickLooseScalarText(stop.departureSpoor) ||
    pickLooseScalarText(arrival0.actualTrack) ||
    pickLooseScalarText(arrival0.actualPlatform) ||
    pickLooseScalarText(arrival0.actualSpoor) ||
    pickLooseScalarText(arrival0.actualArrivalTrack) ||
    pickLooseScalarText(arrival0.actualArrivalPlatform) ||
    pickLooseScalarText(arrival0.actualArrivalSpoor) ||
    pickLooseScalarText(arrival0.actualDepartureTrack) ||
    pickLooseScalarText(arrival0.actualDeparturePlatform) ||
    pickLooseScalarText(arrival0.actualDepartureSpoor) ||
    pickLooseScalarText(arrival0.track) ||
    pickLooseScalarText(arrival0.platform) || // fallback if provider only emits platform
    pickLooseScalarText(arrival0.spoor) ||
    pickLooseScalarText(arrival0.arrivalTrack) ||
    pickLooseScalarText(arrival0.arrivalPlatform) ||
    pickLooseScalarText(arrival0.arrivalSpoor) ||
    pickLooseScalarText(arrival0.departureTrack) ||
    pickLooseScalarText(arrival0.departurePlatform) ||
    pickLooseScalarText(arrival0.departureSpoor) ||
    pickLooseScalarText(departure0.actualTrack) ||
    pickLooseScalarText(departure0.actualPlatform) ||
    pickLooseScalarText(departure0.actualSpoor) ||
    pickLooseScalarText(departure0.actualArrivalTrack) ||
    pickLooseScalarText(departure0.actualArrivalPlatform) ||
    pickLooseScalarText(departure0.actualArrivalSpoor) ||
    pickLooseScalarText(departure0.actualDepartureTrack) ||
    pickLooseScalarText(departure0.actualDeparturePlatform) ||
    pickLooseScalarText(departure0.actualDepartureSpoor) ||
    pickLooseScalarText(departure0.track) ||
    pickLooseScalarText(departure0.platform) || // fallback if provider only emits platform
    pickLooseScalarText(departure0.spoor) ||
    pickLooseScalarText(departure0.arrivalTrack) ||
    pickLooseScalarText(departure0.arrivalPlatform) ||
    pickLooseScalarText(departure0.arrivalSpoor) ||
    pickLooseScalarText(departure0.departureTrack) ||
    pickLooseScalarText(departure0.departurePlatform) ||
    pickLooseScalarText(departure0.departureSpoor);

  return {
    name,
    plannedDateTime,
    actualDateTime,
    plannedTrack,
    actualTrack,
    cancelled: asBoolean(stop.cancelled),
  };
}

function hasStopTime(stop: OvNlTripLegStop): boolean {
  const planned = asText(stop.plannedDateTime);
  const actual = asText(stop.actualDateTime);
  if (actual && Number.isFinite(Date.parse(actual))) return true;
  if (planned && Number.isFinite(Date.parse(planned))) return true;
  return false;
}

function normalizeTripLeg(
  raw: unknown,
  index: number,
  opts?: { includeStops?: boolean }
): OvNlTripLeg {
  const leg = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const origin =
    leg.origin && typeof leg.origin === "object"
      ? (leg.origin as Record<string, unknown>)
      : {};
  const destination =
    leg.destination && typeof leg.destination === "object"
      ? (leg.destination as Record<string, unknown>)
      : {};
  const product =
    leg.product && typeof leg.product === "object"
      ? (leg.product as Record<string, unknown>)
      : {};

  const originName = asText(origin.name) || asText(origin.rawLocationName);
  const destinationName = asText(destination.name) || asText(destination.rawLocationName);

  const stopsRaw = Array.isArray(leg.stops) ? leg.stops : [];
  const stops = opts?.includeStops
    ? stopsRaw
        .map((stop) => normalizeTripLegStop(stop))
        .filter((stop) => hasStopTime(stop))
    : undefined;

  return {
    index: asText(leg.idx) || String(index),
    mode: toKnownTravelType(leg.travelType),
    name: asText(product.displayName) || asText(leg.name) || "Leg",
    direction: asText(leg.direction),
    cancelled: asBoolean(leg.cancelled),
    originName: originName || "Origin",
    originPlannedDateTime: asNullableText(origin.plannedDateTime),
    originActualDateTime: asNullableText(origin.actualDateTime),
    originPlannedTrack: asNullableText(origin.plannedTrack),
    originActualTrack: asNullableText(origin.actualTrack),
    destinationName: destinationName || "Destination",
    destinationPlannedDateTime: asNullableText(destination.plannedDateTime),
    destinationActualDateTime: asNullableText(destination.actualDateTime),
    destinationPlannedTrack: asNullableText(destination.plannedTrack),
    destinationActualTrack: asNullableText(destination.actualTrack),
    journeyDetailRef: asNullableText(leg.journeyDetailRef),
    stopCount: stops ? stops.length : stopsRaw.length,
    ...(stops ? { stops } : {}),
  };
}

function normalizeTripSummary(
  raw: unknown,
  source: string,
  opts?: { includeStops?: boolean }
): OvNlTripSummary {
  const trip = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const legsRaw = Array.isArray(trip.legs) ? trip.legs : [];
  const legs = legsRaw.map((leg, index) => normalizeTripLeg(leg, index, opts));

  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  const primaryMessage =
    trip.primaryMessage && typeof trip.primaryMessage === "object"
      ? asNullableText((trip.primaryMessage as Record<string, unknown>).title)
      : null;

  return {
    uid: asText(trip.uid) || asText(trip.ctxRecon),
    status: asText(trip.status) || "NORMAL",
    source: source || asText(trip.type) || "HARP",
    optimal: asBoolean(trip.optimal),
    realtime: asBoolean(trip.realtime),
    transfers: Math.max(0, Math.floor(asNumberOrNull(trip.transfers) ?? 0)),
    plannedDurationMinutes: asNumberOrNull(trip.plannedDurationInMinutes),
    actualDurationMinutes: asNumberOrNull(trip.actualDurationInMinutes),
    departureName: firstLeg?.originName ?? "",
    departurePlannedDateTime: firstLeg?.originPlannedDateTime ?? null,
    departureActualDateTime: firstLeg?.originActualDateTime ?? null,
    arrivalName: lastLeg?.destinationName ?? "",
    arrivalPlannedDateTime: lastLeg?.destinationPlannedDateTime ?? null,
    arrivalActualDateTime: lastLeg?.destinationActualDateTime ?? null,
    primaryMessage,
    messages: normalizeMessages(trip.messages),
    ctxRecon: asText(trip.ctxRecon),
    routeId: asNullableText(trip.routeId),
    legs,
  };
}

function normalizeJourneyLegs(rawJourney: unknown, fallbackJourneyId: string): OvNlTripLeg[] {
  const journey =
    rawJourney && typeof rawJourney === "object"
      ? (rawJourney as Record<string, unknown>)
      : {};
  const stops = Array.isArray(journey.stops) ? journey.stops : [];
  if (stops.length === 0) return [];

  const legs: OvNlTripLeg[] = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const fromStop =
      stops[i] && typeof stops[i] === "object"
        ? (stops[i] as Record<string, unknown>)
        : {};
    const toStop =
      stops[i + 1] && typeof stops[i + 1] === "object"
        ? (stops[i + 1] as Record<string, unknown>)
        : {};

    const departure = Array.isArray(fromStop.departures)
      ? (fromStop.departures[0] as Record<string, unknown> | undefined)
      : undefined;
    const arrival = Array.isArray(toStop.arrivals)
      ? (toStop.arrivals[0] as Record<string, unknown> | undefined)
      : undefined;

    const fromStation =
      fromStop.stop && typeof fromStop.stop === "object"
        ? (fromStop.stop as Record<string, unknown>)
        : {};
    const toStation =
      toStop.stop && typeof toStop.stop === "object"
        ? (toStop.stop as Record<string, unknown>)
        : {};

    const product =
      departure?.product && typeof departure.product === "object"
        ? (departure.product as Record<string, unknown>)
        : {};

    legs.push({
      index: String(i),
      mode: "PUBLIC_TRANSIT",
      name: asText(product.displayName) || asText(product.longCategoryName) || "Train",
      direction: asText(fromStop.destination),
      cancelled: asBoolean(departure?.cancelled) || asBoolean(arrival?.cancelled),
      originName: asText(fromStation.code) || asText(fromStation.UICCode) || `Stop ${i + 1}`,
      originPlannedDateTime: asNullableText(departure?.plannedTime),
      originActualDateTime: asNullableText(departure?.actualTime),
      originPlannedTrack: asNullableText(departure?.plannedTrack),
      originActualTrack: asNullableText(departure?.actualTrack),
      destinationName:
        asText(toStation.code) || asText(toStation.UICCode) || `Stop ${i + 2}`,
      destinationPlannedDateTime: asNullableText(arrival?.plannedTime),
      destinationActualDateTime: asNullableText(arrival?.actualTime),
      destinationPlannedTrack: asNullableText(arrival?.plannedTrack),
      destinationActualTrack: asNullableText(arrival?.actualTrack),
      journeyDetailRef: fallbackJourneyId || null,
      stopCount: 0,
    });
  }

  return legs;
}

function normalizeDisruption(raw: unknown): OvNlDisruption {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const typeRaw = asText(item.type).toUpperCase();
  const type: OvNlDisruption["type"] =
    typeRaw === "CALAMITY" || typeRaw === "DISRUPTION" || typeRaw === "MAINTENANCE"
      ? typeRaw
      : "DISRUPTION";
  return {
    id: asText(item.id),
    type,
    title: asText(item.title),
    topic: asNullableText(item.topic),
    isActive: asBoolean(item.isActive),
  };
}

function extractTripsAdviceList(raw: unknown): Array<Record<string, unknown>> {
  const hasTripsArray = (value: unknown): value is Record<string, unknown> =>
    Boolean(
      value &&
        typeof value === "object" &&
        Array.isArray((value as Record<string, unknown>).trips)
    );

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

function makeErrorOutput(input: {
  action: OvNlToolAction;
  code: OvNlErrorCode;
  message: string;
  details?: Record<string, unknown>;
}): OvNlToolOutput {
  const error: OvNlToolError = {
    code: input.code,
    message: input.message,
    ...(input.details ? { details: input.details } : {}),
  };
  return {
    kind: "error",
    action: input.action,
    error,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

function mapClientErrorToToolError(error: OvNlClientError): OvNlToolError {
  if (
    error.code === "upstream_unreachable" ||
    error.code === "upstream_http_error" ||
    error.code === "upstream_invalid_response"
  ) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  return {
    code: "unknown",
    message: error.message || "Unknown OV NL upstream error.",
    details: error.details,
  };
}

function resolveSubscriptionKey(
  cfg: NonNullable<ReturnType<typeof getConfig>["ovNl"]>
): string {
  const envName = asText(cfg.subscriptionKeyEnv);
  const key = envName ? asText(process.env[envName]) : "";
  if (!envName || !key) {
    throw new Error(
      `OV NL API key is missing. Set ${envName || "NS_APP_SUBSCRIPTION_KEY"} in your environment.`
    );
  }
  return key;
}

async function callOvNlJson(
  ctx: OvNlActionExecutionContext,
  input: {
    path: string;
    query?: Record<string, string | number | boolean | string[] | null | undefined>;
    headers?: Record<string, string>;
  }
): Promise<
  | { ok: true; json: unknown; ttlSeconds: number }
  | { ok: false; error: OvNlToolError }
> {
  const result = await getOvNlJson({
    baseUrls: ctx.cfg.baseUrls,
    timeoutMs: ctx.cfg.timeoutMs,
    subscriptionKey: ctx.subscriptionKey,
    path: input.path,
    query: input.query,
    headers: input.headers,
  });

  if (!result.ok) {
    return { ok: false, error: mapClientErrorToToolError(result.error) };
  }

  const ttlSeconds = clampTtlSeconds(result.cacheMaxAgeSeconds, ctx.cfg.cacheMaxTtlSeconds);
  ctx.ttlHints.push(ttlSeconds);
  return {
    ok: true,
    json: result.json,
    ttlSeconds,
  };
}

async function searchStations(
  ctx: OvNlActionExecutionContext,
  input: { query: string; limit?: number; countryCodes?: string[] }
): Promise<{ ok: true; stations: OvNlStation[] } | { ok: false; error: OvNlToolError }> {
  const limit = Math.max(1, Math.min(30, Math.floor(input.limit ?? 12)));
  const countryCodes = Array.isArray(input.countryCodes)
    ? input.countryCodes.map((code) => asText(code)).filter(Boolean)
    : [];

  const response = await callOvNlJson(ctx, {
    path: "/api/v2/stations",
    query: {
      q: input.query,
      limit,
      ...(countryCodes.length > 0 ? { countryCodes: countryCodes.join(",") } : {}),
    },
  });
  if (!response.ok) return response;

  const payload = (response.json as { payload?: unknown[] } | null)?.payload;
  if (!Array.isArray(payload)) {
    return {
      ok: false,
      error: {
        code: "upstream_invalid_response",
        message: "NS stations response did not include a payload array.",
      },
    };
  }

  const stations = payload.map((station) => normalizeStation(station)).filter((station) => {
    return Boolean(station.code || station.uicCode);
  });

  return { ok: true, stations };
}

function makeDisambiguationCandidates(
  action: OvNlToolAction,
  query: string,
  stations: OvNlStation[]
): OvNlActionExecutionResult {
  const normalizedQuery = asText(query);
  const candidates = stations
    .map((station) => {
      const confidence = scoreStationCandidate(station, normalizedQuery);
      return {
        id: station.code || station.uicCode || stationDisplayName(station),
        label: `${stationDisplayName(station)} (${station.code || station.uicCode || "?"})`,
        confidence,
        station,
      } satisfies OvNlDisambiguationCandidate;
    })
    .sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label))
    .slice(0, 6);

  return {
    output: {
      kind: "disambiguation",
      action,
      query: normalizedQuery,
      message: `Multiple stations match "${normalizedQuery}". Please pick one station code.`,
      candidates,
      fetchedAt: new Date().toISOString(),
      cached: false,
    },
    cacheTtlSeconds: 30,
  };
}

async function resolveStationFromSearch(
  ctx: OvNlActionExecutionContext,
  input: { action: OvNlToolAction; query: string }
): Promise<OvNlStationResolution> {
  const query = asText(input.query);
  if (!query) {
    return {
      kind: "error",
      error: {
        code: "station_not_found",
        message: "Station query is empty.",
      },
    };
  }

  const stationCandidate = extractStationCodeOrUicCandidate(query);
  const searched = await searchStations(ctx, { query, limit: 12 });
  if (!searched.ok) return { kind: "error", error: searched.error };
  if (searched.stations.length === 0) {
    if (stationCandidate.stationCode || stationCandidate.uicCode) {
      return {
        kind: "resolved",
        station: fallbackStation({
          stationCode: stationCandidate.stationCode,
          uicCode: stationCandidate.uicCode,
          fallbackName: query,
        }),
      };
    }
    return {
      kind: "error",
      error: {
        code: "station_not_found",
        message: `No stations found for "${query}".`,
      },
    };
  }

  if (stationCandidate.stationCode) {
    const exactCode = searched.stations.find(
      (station) => station.code.toUpperCase() === stationCandidate.stationCode
    );
    if (exactCode) return { kind: "resolved", station: exactCode };
  }

  if (stationCandidate.uicCode) {
    const exactUic = searched.stations.find(
      (station) => station.uicCode === stationCandidate.uicCode
    );
    if (exactUic) return { kind: "resolved", station: exactUic };
  }

  const normalizedQuery = normalizeComparable(query);
  const exactNameMatches = searched.stations.filter((station) =>
    stationNameVariants(station).includes(normalizedQuery)
  );
  if (exactNameMatches.length === 1) {
    return { kind: "resolved", station: exactNameMatches[0]! };
  }

  if (searched.stations.length === 1) {
    return { kind: "resolved", station: searched.stations[0]! };
  }

  const scored = searched.stations
    .map((station) => ({ station, score: scoreStationCandidate(station, query) }))
    .sort((a, b) => b.score - a.score);

  const strongFirstTokenMatches = scored.filter(
    ({ station, score }) => score >= 0.9 && stationFirstTokenMatches(station, query)
  );
  if (strongFirstTokenMatches.length === 1) {
    return { kind: "resolved", station: strongFirstTokenMatches[0]!.station };
  }

  const best = scored[0];
  const second = scored[1];
  if (best && best.score >= 0.98 && (!second || best.score - second.score >= 0.12)) {
    return { kind: "resolved", station: best.station };
  }

  const filteredForDisambiguation = scored.filter(
    ({ station, score }, index) =>
      index === 0 || stationFirstTokenMatches(station, query) || score >= 0.7
  );

  return {
    kind: "disambiguation",
    query,
    candidates: filteredForDisambiguation.slice(0, 6).map(({ station, score }) => ({
      id: station.code || station.uicCode || stationDisplayName(station),
      label: `${stationDisplayName(station)} (${station.code || station.uicCode || "?"})`,
      confidence: score,
      station,
    })),
  };
}

function fallbackStation(input: {
  stationCode?: string;
  uicCode?: string;
  fallbackName?: string;
}): OvNlStation {
  const code = asText(input.stationCode).toUpperCase();
  const uicCode = asText(input.uicCode);
  const fallbackName = asText(input.fallbackName) || code || uicCode || "Station";
  return {
    code: code || fallbackName.toUpperCase(),
    uicCode: uicCode || "",
    nameShort: fallbackName,
    nameMedium: fallbackName,
    nameLong: fallbackName,
    countryCode: "",
    lat: null,
    lng: null,
    distanceMeters: null,
  };
}

async function resolveStationFromArgs(
  ctx: OvNlActionExecutionContext,
  input: {
    action: OvNlToolAction;
    station?: string;
    stationCode?: string;
    uicCode?: string;
  }
): Promise<OvNlStationResolution> {
  if (input.stationCode) {
    const searched = await searchStations(ctx, { query: input.stationCode, limit: 6 });
    if (searched.ok) {
      const exact = searched.stations.find(
        (station) => station.code.toUpperCase() === asText(input.stationCode).toUpperCase()
      );
      if (exact) return { kind: "resolved", station: exact };
    }
    return {
      kind: "resolved",
      station: fallbackStation({
        stationCode: input.stationCode,
        uicCode: input.uicCode,
      }),
    };
  }

  if (input.uicCode) {
    const searched = await searchStations(ctx, { query: input.uicCode, limit: 6 });
    if (searched.ok) {
      const exact = searched.stations.find((station) => station.uicCode === asText(input.uicCode));
      if (exact) return { kind: "resolved", station: exact };
    }
    return {
      kind: "resolved",
      station: fallbackStation({
        stationCode: input.station,
        uicCode: input.uicCode,
      }),
    };
  }

  if (input.station) {
    return resolveStationFromSearch(ctx, { action: input.action, query: input.station });
  }

  return {
    kind: "error",
    error: {
      code: "station_not_found",
      message: "Station argument is required.",
    },
  };
}

async function executeAction(
  ctx: OvNlActionExecutionContext,
  validatedInput: z.infer<typeof OvNlGatewayToolValidatedInputSchema>
): Promise<OvNlActionExecutionResult> {
  const action = validatedInput.action;
  const fetchedAt = new Date().toISOString();

  if (action === "stations.search") {
    const searched = await searchStations(ctx, {
      query: validatedInput.args.query,
      limit: validatedInput.args.limit,
      countryCodes: validatedInput.args.countryCodes,
    });
    if (!searched.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: searched.error.code,
          message: searched.error.message,
          details: searched.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "stations.search",
        query: validatedInput.args.query,
        stations: searched.stations,
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "stations.nearest") {
    const lat = validatedInput.args.latitude ?? validatedInput.args.lat ?? 0;
    const lng = validatedInput.args.longitude ?? validatedInput.args.lng ?? 0;
    const limit = Math.max(1, Math.min(20, Math.floor(validatedInput.args.limit ?? 6)));

    const response = await callOvNlJson(ctx, {
      path: "/api/v2/stations/nearest",
      query: { lat, lng, limit },
    });
    if (!response.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    const payload = (response.json as { payload?: unknown[] } | null)?.payload;
    if (!Array.isArray(payload)) {
      return {
        output: makeErrorOutput({
          action,
          code: "upstream_invalid_response",
          message: "NS nearest stations response did not include a payload array.",
        }),
        cacheTtlSeconds: null,
      };
    }

    const stations = payload.map((station) => normalizeStation(station));
    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "stations.nearest",
        latitude: lat,
        longitude: lng,
        stations,
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "departures.window") {
    const stationResult = await resolveStationFromArgs(ctx, {
      action,
      station: validatedInput.args.station,
      stationCode: validatedInput.args.stationCode,
      uicCode: validatedInput.args.uicCode,
    });

    if (stationResult.kind === "error") {
      return {
        output: makeErrorOutput({
          action,
          code: stationResult.error.code,
          message: stationResult.error.message,
          details: stationResult.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    if (stationResult.kind === "disambiguation") {
      return makeDisambiguationCandidates(
        action,
        stationResult.query,
        stationResult.candidates.map((candidate) => candidate.station)
      );
    }

    const nowMs = Date.now();
    const window = resolveDepartureWindowOrError({
      args: validatedInput.args,
      nowMs,
    });
    if (!window.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: window.error.code,
          message: window.error.message,
          details: window.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    // If the requested window is fully in the past, return a clear error instead of an empty board.
    if (window.toMs <= nowMs - 60_000) {
      return {
        output: makeErrorOutput({
          action,
          code: "invalid_tool_input",
          message:
            "Het gevraagde tijdvenster ligt in het verleden. Geef een tijdvenster dat (deels) in de toekomst ligt.",
          details: {
            fromDateTime: window.fromIso,
            toDateTime: window.toIso,
          },
        }),
        cacheTtlSeconds: null,
      };
    }

    const station = stationResult.station;
    const lang = normalizeLanguage(validatedInput.args.lang);

    const requestedMaxJourneys =
      typeof validatedInput.args.maxJourneys === "number" ? validatedInput.args.maxJourneys : null;
    const maxJourneys = Math.max(1, Math.min(200, Math.floor(requestedMaxJourneys ?? 80)));
    const maxFetches = 4;

    const departures: OvNlDeparture[] = [];
    const seen = new Set<string>();
    let firstBatchMinMs: number | null = null;
    let firstBatchMaxMs: number | null = null;
    let cursorMs = window.fromMs;

    for (let fetchIndex = 0; fetchIndex < maxFetches; fetchIndex += 1) {
      const response = await callOvNlJson(ctx, {
        path: "/api/v2/departures",
        query: {
          lang,
          station: station.code || undefined,
          uicCode: station.uicCode || undefined,
          dateTime: new Date(cursorMs).toISOString(),
          maxJourneys,
        },
      });
      if (!response.ok) {
        return {
          output: makeErrorOutput({
            action,
            code: response.error.code,
            message: response.error.message,
            details: response.error.details,
          }),
          cacheTtlSeconds: null,
        };
      }

      const payload = (response.json as { payload?: Record<string, unknown> } | null)?.payload;
      if (!payload || typeof payload !== "object") {
        return {
          output: makeErrorOutput({
            action,
            code: "upstream_invalid_response",
            message: "NS departures response did not include payload.",
          }),
          cacheTtlSeconds: null,
        };
      }

      const departuresRaw = Array.isArray(payload.departures) ? payload.departures : [];
      if (departuresRaw.length === 0) break;

      let maxSeenMs: number | null = null;
      const normalized = departuresRaw.map((departure, index) => normalizeDeparture(departure, index));
      for (const dep of normalized) {
        const dtMs = Date.parse(dep.plannedDateTime);
        if (Number.isFinite(dtMs)) {
          maxSeenMs = Math.max(maxSeenMs ?? dtMs, dtMs);
          if (fetchIndex === 0) {
            firstBatchMinMs = Math.min(firstBatchMinMs ?? dtMs, dtMs);
            firstBatchMaxMs = Math.max(firstBatchMaxMs ?? dtMs, dtMs);
          }
          if (dtMs >= window.fromMs && dtMs < window.toMs) {
            const dedupeKey =
              dep.journeyDetailRef ||
              `${dep.plannedDateTime}|${dep.destination}|${dep.trainCategory}|${dep.trainNumber}`;
            if (!seen.has(dedupeKey)) {
              seen.add(dedupeKey);
              departures.push({ ...dep, id: dedupeKey });
            }
          }
        }
      }

      if (maxSeenMs == null) break;
      if (maxSeenMs >= window.toMs) break;

      const nextCursorMs = Math.max(cursorMs + 1000, maxSeenMs + 1000);
      if (nextCursorMs <= cursorMs) break;
      cursorMs = nextCursorMs;
    }

    // Detect likely unsupported dateTime filtering (some API docs claim this only works for foreign stations).
    if (
      departures.length === 0 &&
      window.fromMs > nowMs + 30 * 60_000 &&
      firstBatchMinMs != null &&
      firstBatchMinMs < window.fromMs - 5 * 60_000
    ) {
      return {
        output: makeErrorOutput({
          action,
          code: "upstream_invalid_response",
          message:
            "NS Reisinformatie kon geen vertrekken ophalen voor dit tijdvenster. Mogelijk ondersteunt de API geen vertrekborden op een toekomstige starttijd voor dit station.",
          details: {
            fromDateTime: window.fromIso,
            toDateTime: window.toIso,
            station: station.code,
            firstBatchMinDateTime:
              firstBatchMinMs != null ? new Date(firstBatchMinMs).toISOString() : null,
            firstBatchMaxDateTime:
              firstBatchMaxMs != null ? new Date(firstBatchMaxMs).toISOString() : null,
          },
        }),
        cacheTtlSeconds: null,
      };
    }

    departures.sort((a, b) => {
      const aMs = Date.parse(a.plannedDateTime);
      const bMs = Date.parse(b.plannedDateTime);
      if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs;
      return a.destination.localeCompare(b.destination);
    });

    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "departures.window",
        station,
        window: {
          fromDateTime: window.fromIso,
          toDateTime: window.toIso,
          timeZone: OV_NL_TIME_ZONE,
        },
        departures,
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "departures.list" || action === "arrivals.list") {
    const stationResult = await resolveStationFromArgs(ctx, {
      action,
      station: validatedInput.args.station,
      stationCode: validatedInput.args.stationCode,
      uicCode: validatedInput.args.uicCode,
    });

    if (stationResult.kind === "error") {
      return {
        output: makeErrorOutput({
          action,
          code: stationResult.error.code,
          message: stationResult.error.message,
          details: stationResult.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    if (stationResult.kind === "disambiguation") {
      const disambiguation = makeDisambiguationCandidates(
        action,
        stationResult.query,
        stationResult.candidates.map((candidate) => candidate.station)
      );
      return disambiguation;
    }

    const station = stationResult.station;
    const lang = normalizeLanguage(validatedInput.args.lang);
    const response = await callOvNlJson(ctx, {
      path: action === "departures.list" ? "/api/v2/departures" : "/api/v2/arrivals",
      query: {
        lang,
        station: station.code || undefined,
        uicCode: station.uicCode || undefined,
        dateTime: normalizeDateTimeInput(validatedInput.args.dateTime),
        maxJourneys: validatedInput.args.maxJourneys ?? 40,
      },
    });

    if (!response.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    const payload = (response.json as { payload?: Record<string, unknown> } | null)?.payload;
    if (!payload || typeof payload !== "object") {
      return {
        output: makeErrorOutput({
          action,
          code: "upstream_invalid_response",
          message: "NS departures/arrivals response did not include payload.",
        }),
        cacheTtlSeconds: null,
      };
    }

    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    if (action === "departures.list") {
      const departuresRaw = Array.isArray(payload.departures) ? payload.departures : [];
      return {
        output: {
          kind: "departures.list",
          station,
          departures: departuresRaw.map((departure, index) => normalizeDeparture(departure, index)),
          cacheTtlSeconds,
          fetchedAt,
          cached: false,
        },
        cacheTtlSeconds,
      };
    }

    const arrivalsRaw = Array.isArray(payload.arrivals) ? payload.arrivals : [];
    return {
      output: {
        kind: "arrivals.list",
        station,
        arrivals: arrivalsRaw.map((arrival, index) => normalizeArrival(arrival, index)),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "trips.search") {
    const fromResolved = await resolveStationFromSearch(ctx, {
      action,
      query: validatedInput.args.from,
    });
    if (fromResolved.kind === "error") {
      return {
        output: makeErrorOutput({
          action,
          code: fromResolved.error.code,
          message: fromResolved.error.message,
          details: fromResolved.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }
    if (fromResolved.kind === "disambiguation") {
      return makeDisambiguationCandidates(
        action,
        fromResolved.query,
        fromResolved.candidates.map((candidate) => candidate.station)
      );
    }

    const toResolved = await resolveStationFromSearch(ctx, {
      action,
      query: validatedInput.args.to,
    });
    if (toResolved.kind === "error") {
      return {
        output: makeErrorOutput({
          action,
          code: toResolved.error.code,
          message: toResolved.error.message,
          details: toResolved.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }
    if (toResolved.kind === "disambiguation") {
      return makeDisambiguationCandidates(
        action,
        toResolved.query,
        toResolved.candidates.map((candidate) => candidate.station)
      );
    }

    let via: OvNlStation | null = null;
    if (validatedInput.args.via) {
      const viaResolved = await resolveStationFromSearch(ctx, {
        action,
        query: validatedInput.args.via,
      });
      if (viaResolved.kind === "error") {
        return {
          output: makeErrorOutput({
            action,
            code: viaResolved.error.code,
            message: viaResolved.error.message,
            details: viaResolved.error.details,
          }),
          cacheTtlSeconds: null,
        };
      }
      if (viaResolved.kind === "disambiguation") {
        return makeDisambiguationCandidates(
          action,
          viaResolved.query,
          viaResolved.candidates.map((candidate) => candidate.station)
        );
      }
      via = viaResolved.station;
    }

    const lang = normalizeLanguage(validatedInput.args.lang);
    const nowMs = Date.now();
    const requestedDateTime = normalizeDateTimeInput(validatedInput.args.dateTime, nowMs);
    const effectiveDateTime = coerceTripsSearchDateTimeToNowIfPast({
      requested: requestedDateTime,
      nowMs,
    });
    const response = await callOvNlJson(ctx, {
      path: "/api/v3/trips",
      query: {
        lang,
        fromStation: fromResolved.station.code,
        toStation: toResolved.station.code,
        viaStation: via?.code || undefined,
        dateTime: effectiveDateTime,
        searchForArrival: validatedInput.args.searchForArrival,
      },
    });
    if (!response.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    const advices = extractTripsAdviceList(response.json);
    if (advices.length === 0) {
      return {
        output: makeErrorOutput({
          action,
          code: "upstream_invalid_response",
          message: "NS trips response is not in a supported format.",
        }),
        cacheTtlSeconds: null,
      };
    }

    const limit = Math.max(1, Math.min(20, Math.floor(validatedInput.args.limit ?? 8)));
    const allTrips = advices
      .flatMap((advice) => {
        const adviceObj = advice;
        const source = asText(adviceObj.source);
        const tripsRaw = Array.isArray(adviceObj.trips) ? adviceObj.trips : [];
        return tripsRaw.map((trip) => normalizeTripSummary(trip, source));
      });

    const trips = filterDepartedTrips(allTrips, nowMs).slice(0, limit);

    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "trips.search",
        from: fromResolved.station,
        to: toResolved.station,
        via,
        trips,
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "trips.detail") {
    const lang = normalizeLanguage(validatedInput.args.lang);
    const response = await callOvNlJson(ctx, {
      path: "/api/v3/trips/trip",
      query: {
        ctxRecon: validatedInput.args.ctxRecon,
        date: normalizeDateTimeInput(validatedInput.args.date),
      },
      headers: {
        lang,
      },
    });
    if (!response.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    if (!response.json || typeof response.json !== "object" || Array.isArray(response.json)) {
      return {
        output: makeErrorOutput({
          action,
          code: "upstream_invalid_response",
          message: "NS trip detail response is not an object.",
        }),
        cacheTtlSeconds: null,
      };
    }

    const trip = normalizeTripSummary(response.json, "trip.detail", { includeStops: true });
    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "trips.detail",
        trip,
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "journey.detail") {
    const response = await callOvNlJson(ctx, {
      path: "/api/v2/journey",
      query: {
        id: validatedInput.args.id,
        train: validatedInput.args.train,
        dateTime: normalizeDateTimeInput(validatedInput.args.dateTime),
        departureUicCode: validatedInput.args.departureUicCode,
        transferUicCode: validatedInput.args.transferUicCode,
        arrivalUicCode: validatedInput.args.arrivalUicCode,
        omitCrowdForecast: validatedInput.args.omitCrowdForecast,
      },
    });
    if (!response.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    const payload = (response.json as { payload?: unknown } | null)?.payload;
    if (!payload || typeof payload !== "object") {
      return {
        output: makeErrorOutput({
          action,
          code: "upstream_invalid_response",
          message: "NS journey detail response did not include payload.",
        }),
        cacheTtlSeconds: null,
      };
    }

    const journeyId = validatedInput.args.id ?? "";
    const legs = normalizeJourneyLegs(payload, journeyId);
    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "journey.detail",
        journeyId,
        trainNumber:
          typeof validatedInput.args.train === "number"
            ? String(validatedInput.args.train)
            : null,
        legs,
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "disruptions.list") {
    const lang = normalizeLanguage(validatedInput.args.lang);
    const response = await callOvNlJson(ctx, {
      path: "/api/v3/disruptions",
      query: {
        type: validatedInput.args.type,
        isActive: validatedInput.args.isActive,
      },
      headers: {
        "Accept-Language":
          lang === "nl" ? "nl-NL, nl;q=0.9, en;q=0.8, *;q=0.5" : "en-US, en;q=0.9, *;q=0.5",
      },
    });
    if (!response.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    if (!Array.isArray(response.json)) {
      return {
        output: makeErrorOutput({
          action,
          code: "upstream_invalid_response",
          message: "NS disruptions response is not an array.",
        }),
        cacheTtlSeconds: null,
      };
    }

    const disruptions = response.json.map((item) => normalizeDisruption(item));
    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "disruptions.list",
        disruptions,
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "disruptions.by_station") {
    const stationResult = await resolveStationFromSearch(ctx, {
      action,
      query: validatedInput.args.station,
    });

    if (stationResult.kind === "error") {
      return {
        output: makeErrorOutput({
          action,
          code: stationResult.error.code,
          message: stationResult.error.message,
          details: stationResult.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    if (stationResult.kind === "disambiguation") {
      return makeDisambiguationCandidates(
        action,
        stationResult.query,
        stationResult.candidates.map((candidate) => candidate.station)
      );
    }

    const station = stationResult.station;
    const response = await callOvNlJson(ctx, {
      path: `/api/v3/disruptions/station/${encodeURIComponent(station.code)}`,
    });
    if (!response.ok) {
      return {
        output: makeErrorOutput({
          action,
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
        }),
        cacheTtlSeconds: null,
      };
    }

    if (!Array.isArray(response.json)) {
      return {
        output: makeErrorOutput({
          action,
          code: "upstream_invalid_response",
          message: "NS station disruptions response is not an array.",
        }),
        cacheTtlSeconds: null,
      };
    }

    const disruptions = response.json.map((item) => normalizeDisruption(item));
    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "disruptions.by_station",
        station,
        disruptions,
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  const response = await callOvNlJson(ctx, {
    path: `/api/v3/disruptions/${encodeURIComponent(validatedInput.args.type)}/${encodeURIComponent(
      validatedInput.args.id
    )}`,
  });
  if (!response.ok) {
    return {
      output: makeErrorOutput({
        action,
        code: response.error.code,
        message: response.error.message,
        details: response.error.details,
      }),
      cacheTtlSeconds: null,
    };
  }

  if (!response.json || typeof response.json !== "object" || Array.isArray(response.json)) {
    return {
      output: makeErrorOutput({
        action,
        code: "upstream_invalid_response",
        message: "NS disruption detail response is not an object.",
      }),
      cacheTtlSeconds: null,
    };
  }

  const disruption = normalizeDisruption(response.json);
  const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
  return {
    output: {
      kind: "disruptions.detail",
      disruption,
      cacheTtlSeconds,
      fetchedAt,
      cached: false,
    },
    cacheTtlSeconds,
  };
}

export function createOvNlTools(input: { request: Request }): OvNlGatewayToolsResult {
  const cfg = getConfig().ovNl;
  if (!cfg || !cfg.enabled) return { enabled: false, tools: {} };

  if (cfg.access === "localhost" && !isLocalhostRequest(input.request)) {
    return { enabled: false, tools: {} };
  }
  if (cfg.access === "lan" && !isRequestAllowedByAdminPolicy(input.request)) {
    return { enabled: false, tools: {} };
  }

  const ovNlGateway = createTool({
    description:
      "Gateway for Dutch rail (NS) reisinformatie. Supports stations, departures, arrivals, trips, journey details, and disruptions with normalized output.",
    inputSchema: OvNlGatewayToolWireInputSchema,
    execute: async (toolInput): Promise<OvNlToolOutput> => {
      const action = asText((toolInput as { action?: unknown }).action) as OvNlToolAction;
      const rawArgs = (toolInput as { args?: unknown }).args;
      const looseArgs =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
      const args = sanitizeLooseToolArgs(looseArgs);
      const parsed = OvNlGatewayToolValidatedInputSchema.safeParse({
        action,
        args,
      });

      if (!parsed.success) {
        return makeErrorOutput({
          action: action || "stations.search",
          code: "invalid_tool_input",
          message: "Invalid ovNlGateway tool input.",
          details: { issues: parsed.error.issues },
        });
      }

      const cacheKey = makeCacheKey(parsed.data.action, parsed.data.args);
      const cachedOutput = getCachedOutput(cacheKey);
      if (cachedOutput) {
        logEvent("info", "ov_nl.gateway_result", {
          action: parsed.data.action,
          kind: cachedOutput.kind,
          cached: true,
          cacheTtlSeconds: "cacheTtlSeconds" in cachedOutput ? cachedOutput.cacheTtlSeconds : null,
        });
        return cachedOutput;
      }

      let subscriptionKey: string;
      try {
        subscriptionKey = resolveSubscriptionKey(cfg);
      } catch (err) {
        return makeErrorOutput({
          action: parsed.data.action,
          code: "config_error",
          message: err instanceof Error ? err.message : "Missing OV NL API key configuration.",
        });
      }

      const ctx: OvNlActionExecutionContext = {
        cfg,
        subscriptionKey,
        ttlHints: [],
      };

      const result = await executeAction(ctx, parsed.data);
      if (result.output.kind !== "error" && result.cacheTtlSeconds != null) {
        setCachedOutput(cacheKey, result.output, result.cacheTtlSeconds);
      }
      logEvent("info", "ov_nl.gateway_result", {
        action: parsed.data.action,
        kind: result.output.kind,
        cached: result.output.cached,
        cacheTtlSeconds: "cacheTtlSeconds" in result.output ? result.output.cacheTtlSeconds : null,
      });
      return result.output;
    },
  });

  return {
    enabled: true,
    tools: { ovNlGateway },
  };
}

export const __test__ = {
  OvNlGatewayToolWireInputSchema,
  OvNlGatewayToolValidatedInputSchema,
  makeCacheKey,
  normalizeStation,
  normalizeTripSummary,
  normalizeJourneyLegs,
  resetCache() {
    ovNlCache.clear();
  },
};
