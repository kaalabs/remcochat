import { tool as createTool } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { logEvent } from "@/server/log";
import { isLocalhostRequest, isRequestAllowedByAdminPolicy } from "@/server/request-auth";
import type { OvNlClientError } from "@/server/integrations/ov-nl/client";
import {
  nsArrivals,
  nsDepartures,
  nsDisruptionDetail,
  nsDisruptions,
  nsDisruptionsByStation,
  nsJourneyDetail,
  nsStationsNearest,
  nsStationsSearch,
  nsTripDetail,
  nsTripsSearch,
  type NsClientConfig,
} from "@/server/ov/ns-client";
import {
  applyTripsTextHeuristicsToArgs,
  extractRouteFromText,
} from "@/lib/ov-nl-route-heuristics";
import { OV_NL_CTX_RECON_MAX_LEN } from "@/lib/ov-nl-constants";
import type {
  OvNlArrival,
  OvNlDeparture,
  OvNlDisambiguationCandidate,
  OvNlDisruption,
  OvNlErrorCode,
  OvNlIntent,
  OvNlIntentHard,
  OvNlIntentMeta,
  OvNlIntentMode,
  OvNlIntentRank,
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
const OvNlIntentModeSchema = z.enum([
  "PUBLIC_TRANSIT",
  "WALK",
  "TRANSFER",
  "BIKE",
  "CAR",
  "KISS",
  "TAXI",
  "UNKNOWN",
]);
const OvNlIntentRankSchema = z.enum([
  "fastest",
  "fewest_transfers",
  "earliest_departure",
  "earliest_arrival",
  "realtime_first",
  "least_walking",
]);
const OvNlDisruptionTypeSchema = z.enum(["CALAMITY", "DISRUPTION", "MAINTENANCE"]);
const OvNlIntentHardSchema = z
  .object({
    directOnly: z.boolean().optional(),
    maxTransfers: z.number().int().min(0).max(8).optional(),
    maxDurationMinutes: z.number().int().min(1).max(24 * 60).optional(),
    departureAfter: DateTimeInputSchema.optional(),
    departureBefore: DateTimeInputSchema.optional(),
    arrivalAfter: DateTimeInputSchema.optional(),
    arrivalBefore: DateTimeInputSchema.optional(),
    includeModes: z.array(OvNlIntentModeSchema).max(8).optional(),
    excludeModes: z.array(OvNlIntentModeSchema).max(8).optional(),
    includeOperators: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
    excludeOperators: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
    includeTrainCategories: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
    excludeTrainCategories: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
    avoidStations: z.array(z.string().trim().min(1).max(120)).max(24).optional(),
    excludeCancelled: z.boolean().optional(),
    requireRealtime: z.boolean().optional(),
    platformEquals: z.string().trim().min(1).max(32).optional(),
    disruptionTypes: z.array(OvNlDisruptionTypeSchema).max(3).optional(),
    activeOnly: z.boolean().optional(),
  })
  .strip();

const OvNlIntentSoftSchema = z
  .object({
    rankBy: z.array(OvNlIntentRankSchema).max(6).optional(),
  })
  .strip();

const OvNlIntentSchema = z
  .object({
    hard: OvNlIntentHardSchema.optional(),
    soft: OvNlIntentSoftSchema.optional(),
  })
  .strip();

const StationsSearchArgsSchema = z
  .object({
    query: z.string().trim().min(2).max(120),
    limit: z.number().int().min(1).max(30).optional(),
    countryCodes: z.array(z.string().trim().min(1).max(8)).max(8).optional(),
    intent: OvNlIntentSchema.optional(),
  })
  .strip();

const StationsNearestArgsSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    limit: z.number().int().min(1).max(20).optional(),
    intent: OvNlIntentSchema.optional(),
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
    intent: OvNlIntentSchema.optional(),
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
    intent: OvNlIntentSchema.optional(),
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
    intent: OvNlIntentSchema.optional(),
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
    intent: OvNlIntentSchema.optional(),
  })
  .strip();

const TripsDetailArgsSchema = z
  .object({
    ctxRecon: z.string().trim().min(1).max(OV_NL_CTX_RECON_MAX_LEN),
    date: DateTimeInputSchema.optional(),
    lang: z.string().trim().min(2).max(12).optional(),
    intent: OvNlIntentSchema.optional(),
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
    intent: OvNlIntentSchema.optional(),
  })
  .strip()
  .refine((v) => Boolean(v.id || v.train), "journey.detail requires id or train");

const DisruptionsListArgsSchema = z
  .object({
    type: z
      .array(OvNlDisruptionTypeSchema)
      .max(3)
      .optional(),
    isActive: z.boolean().optional(),
    lang: z.string().trim().min(2).max(64).optional(),
    intent: OvNlIntentSchema.optional(),
  })
  .strip();

const DisruptionsByStationArgsSchema = z
  .object({
    station: z.string().trim().min(1).max(120),
    intent: OvNlIntentSchema.optional(),
  })
  .strip();

const DisruptionsDetailArgsSchema = z
  .object({
    type: OvNlDisruptionTypeSchema,
    id: z.string().trim().min(1).max(120),
    intent: OvNlIntentSchema.optional(),
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
    ctxRecon: LooseString(OV_NL_CTX_RECON_MAX_LEN),

    id: LooseString(4000),
    train: z.number().int().min(1).max(99_999).optional(),
    departureUicCode: LooseString(32),
    transferUicCode: LooseString(32),
    arrivalUicCode: LooseString(32),
    omitCrowdForecast: z.boolean().optional(),

    type: z
      .union([
        OvNlDisruptionTypeSchema,
        z.array(OvNlDisruptionTypeSchema).max(3),
      ])
      .optional(),
    isActive: z.boolean().optional(),
    intent: z
      .object({
        hard: z
          .object({
            directOnly: z.boolean().optional(),
            maxTransfers: z.number().int().optional(),
            maxDurationMinutes: z.number().int().optional(),
            departureAfter: LooseString(64),
            departureBefore: LooseString(64),
            arrivalAfter: LooseString(64),
            arrivalBefore: LooseString(64),
            includeModes: z.array(OvNlIntentModeSchema).optional(),
            excludeModes: z.array(OvNlIntentModeSchema).optional(),
            includeOperators: z.array(LooseString(64)).optional(),
            excludeOperators: z.array(LooseString(64)).optional(),
            includeTrainCategories: z.array(LooseString(64)).optional(),
            excludeTrainCategories: z.array(LooseString(64)).optional(),
            avoidStations: z.array(LooseString(120)).optional(),
            excludeCancelled: z.boolean().optional(),
            requireRealtime: z.boolean().optional(),
            platformEquals: LooseString(32),
            disruptionTypes: z.array(OvNlDisruptionTypeSchema).optional(),
            activeOnly: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        soft: z
          .object({
            rankBy: z.array(OvNlIntentRankSchema).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
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
  if (value === null) return undefined;
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

function autoFixActionAndArgs(input: {
  action: OvNlToolAction;
  args: Record<string, unknown>;
}): { action: OvNlToolAction; args: Record<string, unknown> } {
  // Detail endpoints return a single entity, so intent constraints (filters/ranking) do not apply.
  // Models sometimes carry over intent from the previous search; strip it to avoid user-visible errors.
  if (
    (input.action === "trips.detail" ||
      input.action === "journey.detail" ||
      input.action === "disruptions.detail") &&
    input.args.intent != null
  ) {
    const nextArgs = { ...input.args };
    delete nextArgs.intent;
    return { action: input.action, args: nextArgs };
  }

  const query = typeof input.args.query === "string" ? input.args.query.trim() : "";
  const route = query ? extractRouteFromText(query) : null;

  if (input.action === "stations.search" && route) {
    const nextArgsBase: Record<string, unknown> = {
      from: route.from,
      to: route.to,
    };
    if (input.args.dateTime != null) nextArgsBase.dateTime = input.args.dateTime;
    if (input.args.searchForArrival != null) nextArgsBase.searchForArrival = input.args.searchForArrival;
    if (input.args.limit != null) nextArgsBase.limit = input.args.limit;
    if (input.args.lang != null) nextArgsBase.lang = input.args.lang;
    if (input.args.intent != null) nextArgsBase.intent = input.args.intent;

    const nextArgs = applyTripsTextHeuristicsToArgs({
      text: query,
      args: nextArgsBase,
    });
    return { action: "trips.search", args: nextArgs };
  }

  if (input.action === "trips.search" && query) {
    const nextArgs = applyTripsTextHeuristicsToArgs({
      text: query,
      args: { ...input.args },
    });
    return { action: input.action, args: nextArgs };
  }

  return input;
}

function parseBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["true", "1", "yes", "y", "ja"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "nee"].includes(normalized)) return false;
  }
  return undefined;
}

function parseNumberLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseIntegerLike(value: unknown): number | undefined {
  const parsed = parseNumberLike(value);
  if (parsed == null) return undefined;
  if (!Number.isFinite(parsed)) return undefined;
  if (!Number.isInteger(parsed)) return Math.trunc(parsed);
  return parsed;
}

function coerceArrayLike(value: unknown): unknown[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value;
  return [value];
}

function coerceToolArgsForValidation(action: OvNlToolAction, args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;

  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };

  const numericKeys: ReadonlyArray<string> = ["latitude", "longitude", "lat", "lng"];
  for (const key of numericKeys) {
    if (!(key in out)) continue;
    const coerced = parseNumberLike(out[key]);
    if (coerced != null) out[key] = coerced;
  }

  const integerKeys: ReadonlyArray<string> = ["limit", "maxJourneys", "train"];
  for (const key of integerKeys) {
    if (!(key in out)) continue;
    const coerced = parseIntegerLike(out[key]);
    if (coerced != null) out[key] = coerced;
  }

  const booleanKeys: ReadonlyArray<string> = ["searchForArrival", "omitCrowdForecast", "isActive"];
  for (const key of booleanKeys) {
    if (!(key in out)) continue;
    const coerced = parseBooleanLike(out[key]);
    if (coerced != null) out[key] = coerced;
  }

  if (action === "disruptions.list" && typeof out.type === "string") {
    out.type = [out.type];
  }

  if (out.intent && typeof out.intent === "object" && !Array.isArray(out.intent)) {
    const intent = { ...(out.intent as Record<string, unknown>) };

    if (intent.soft && typeof intent.soft === "object" && !Array.isArray(intent.soft)) {
      const soft = { ...(intent.soft as Record<string, unknown>) };
      if (typeof soft.rankBy === "string") {
        soft.rankBy = [soft.rankBy];
      }
      intent.soft = soft;
    }

    if (intent.hard && typeof intent.hard === "object" && !Array.isArray(intent.hard)) {
      const hard = { ...(intent.hard as Record<string, unknown>) };
      const hardBooleanKeys: ReadonlyArray<string> = [
        "directOnly",
        "excludeCancelled",
        "requireRealtime",
        "activeOnly",
      ];
      for (const key of hardBooleanKeys) {
        if (!(key in hard)) continue;
        const coerced = parseBooleanLike(hard[key]);
        if (coerced != null) hard[key] = coerced;
      }

      const hardIntegerKeys: ReadonlyArray<string> = ["maxTransfers", "maxDurationMinutes"];
      for (const key of hardIntegerKeys) {
        if (!(key in hard)) continue;
        const coerced = parseIntegerLike(hard[key]);
        if (coerced != null) hard[key] = coerced;
      }
      if ("maxTransfers" in hard) {
        const raw = parseIntegerLike(hard.maxTransfers);
        if (raw == null || raw < 0) delete hard.maxTransfers;
        else hard.maxTransfers = Math.min(8, raw);
      }
      if ("maxDurationMinutes" in hard) {
        const raw = parseIntegerLike(hard.maxDurationMinutes);
        if (raw == null || raw < 1) delete hard.maxDurationMinutes;
        else hard.maxDurationMinutes = Math.min(24 * 60, raw);
      }

      const hardArrayKeys: ReadonlyArray<string> = [
        "includeModes",
        "excludeModes",
        "includeOperators",
        "excludeOperators",
        "includeTrainCategories",
        "excludeTrainCategories",
        "avoidStations",
        "disruptionTypes",
      ];
      for (const key of hardArrayKeys) {
        if (!(key in hard)) continue;
        const coerced = coerceArrayLike(hard[key]);
        if (coerced != null) hard[key] = coerced;
      }

      intent.hard = hard;
    }

    out.intent = intent;
  }

  return out;
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

  const relativeMatch = normalized.match(/^(today|tomorrow|yesterday)@(\d{2}):(\d{2})$/);
  if (relativeMatch) {
    const dayKey = relativeMatch[1];
    const hour = Number(relativeMatch[2]);
    const minute = Number(relativeMatch[3]);
    if (
      Number.isFinite(hour) &&
      Number.isFinite(minute) &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ) {
      const dayDelta = dayKey === "tomorrow" ? 1 : dayKey === "yesterday" ? -1 : 0;
      const dateParts = addDaysToDateParts(
        currentDatePartsInTimeZone(OV_NL_TIME_ZONE, nowMs),
        dayDelta
      );
      const targetMs = zonedLocalDateTimeToUtcMs({
        timeZone: OV_NL_TIME_ZONE,
        ...dateParts,
        hour,
        minute,
      });
      return new Date(targetMs).toISOString();
    }
  }

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
  if (normalized === "vanmorgen" || normalized === "this morning") {
    return normalizeDateTimeInput("today@09:00", nowMs);
  }
  if (normalized === "vanmiddag" || normalized === "this afternoon") {
    return normalizeDateTimeInput("today@15:00", nowMs);
  }
  if (normalized === "vanavond" || normalized === "this evening") {
    return normalizeDateTimeInput("today@19:00", nowMs);
  }
  if (normalized === "vannacht" || normalized === "tonight") {
    return normalizeDateTimeInput("today@23:30", nowMs);
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

const OV_NL_INTENT_HARD_KEYS = [
  "directOnly",
  "maxTransfers",
  "maxDurationMinutes",
  "departureAfter",
  "departureBefore",
  "arrivalAfter",
  "arrivalBefore",
  "includeModes",
  "excludeModes",
  "includeOperators",
  "excludeOperators",
  "includeTrainCategories",
  "excludeTrainCategories",
  "avoidStations",
  "excludeCancelled",
  "requireRealtime",
  "platformEquals",
  "disruptionTypes",
  "activeOnly",
] as const;

type OvNlIntentHardKey = (typeof OV_NL_INTENT_HARD_KEYS)[number];
type BoardRow = OvNlDeparture | OvNlArrival;

function hasOwnKey<T extends object>(value: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasMeaningfulHardValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function hasIntentPayload(intent: OvNlIntent | undefined): boolean {
  if (!intent) return false;
  const hard = intent.hard;
  const soft = intent.soft;
  if (hard) {
    for (const key of OV_NL_INTENT_HARD_KEYS) {
      if (hasOwnKey(hard, key) && hasMeaningfulHardValue(hard[key])) return true;
    }
  }
  if (Array.isArray(soft?.rankBy) && soft.rankBy.length > 0) return true;
  return false;
}

function presentHardKeys(hard: OvNlIntentHard | undefined): OvNlIntentHardKey[] {
  if (!hard) return [];
  const keys: OvNlIntentHardKey[] = [];
  for (const key of OV_NL_INTENT_HARD_KEYS) {
    if (hasOwnKey(hard, key) && hasMeaningfulHardValue(hard[key])) keys.push(key);
  }
  return keys;
}

function uniqueSoftRanks(soft: OvNlIntent["soft"]): OvNlIntentRank[] {
  if (!Array.isArray(soft?.rankBy)) return [];
  const out: OvNlIntentRank[] = [];
  const seen = new Set<OvNlIntentRank>();
  for (const rank of soft.rankBy) {
    if (seen.has(rank)) continue;
    seen.add(rank);
    out.push(rank);
  }
  return out;
}

function partitionSoftRanks(input: {
  all: OvNlIntentRank[];
  supported: readonly OvNlIntentRank[];
}): { applied: OvNlIntentRank[]; ignored: OvNlIntentRank[] } {
  const supportedSet = new Set(input.supported);
  const applied: OvNlIntentRank[] = [];
  const ignored: OvNlIntentRank[] = [];
  for (const rank of input.all) {
    if (supportedSet.has(rank)) applied.push(rank);
    else ignored.push(rank);
  }
  return { applied, ignored };
}

function normalizeStringSet(values: string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(values)) return out;
  for (const value of values) {
    const normalized = normalizeComparable(value);
    if (normalized) out.add(normalized);
  }
  return out;
}

function normalizeModeSet(values: OvNlIntentMode[] | undefined): Set<OvNlIntentMode> {
  const out = new Set<OvNlIntentMode>();
  if (!Array.isArray(values)) return out;
  for (const value of values) out.add(value);
  return out;
}

function parseDateTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveIntentDateConstraintMs(input: {
  raw: string | undefined;
  nowMs: number;
  key: string;
}): { ok: true; ms: number | null } | { ok: false; error: OvNlToolError } {
  if (!input.raw) return { ok: true, ms: null };
  const normalized = normalizeDateTimeInput(input.raw, input.nowMs);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: "invalid_tool_input",
        message: `Invalid intent date/time value for ${input.key}.`,
        details: { key: input.key, value: input.raw },
      },
    };
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      error: {
        code: "invalid_tool_input",
        message: `Invalid intent date/time value for ${input.key}.`,
        details: { key: input.key, value: input.raw },
      },
    };
  }
  return { ok: true, ms: parsed };
}

function compareNullableNumberAsc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function stableSort<T>(rows: T[], compare: (a: T, b: T) => number): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const c = compare(a.row, b.row);
      if (c !== 0) return c;
      return a.index - b.index;
    })
    .map((item) => item.row);
}

function firstTripDepartureMs(trip: OvNlTripSummary): number | null {
  return parseDateTimeMs(trip.departureActualDateTime || trip.departurePlannedDateTime);
}

function finalTripArrivalMs(trip: OvNlTripSummary): number | null {
  return parseDateTimeMs(trip.arrivalActualDateTime || trip.arrivalPlannedDateTime);
}

function tripDurationMinutes(trip: OvNlTripSummary): number | null {
  const value = trip.actualDurationMinutes ?? trip.plannedDurationMinutes;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function tripWalkingLegCount(trip: OvNlTripSummary): number {
  return trip.legs.filter((leg) => leg.mode === "WALK").length;
}

function tripTouchesStation(trip: OvNlTripSummary, stationTokens: Set<string>): boolean {
  if (stationTokens.size === 0) return false;
  const names: string[] = [trip.departureName, trip.arrivalName];
  for (const leg of trip.legs) {
    names.push(leg.originName, leg.destinationName);
    if (Array.isArray(leg.stops)) {
      for (const stop of leg.stops) names.push(stop.name);
    }
  }
  return names.some((name) => stationTokens.has(normalizeComparable(name)));
}

function tripMatchesOperatorTokens(trip: OvNlTripSummary, tokens: Set<string>): boolean {
  if (tokens.size === 0) return false;
  return trip.legs.some((leg) => {
    const normalized = normalizeComparable(leg.name);
    if (!normalized) return false;
    for (const token of tokens) {
      if (normalized.includes(token)) return true;
    }
    return false;
  });
}

function tripMatchesCategoryTokens(trip: OvNlTripSummary, tokens: Set<string>): boolean {
  if (tokens.size === 0) return false;
  return trip.legs.some((leg) => {
    const normalized = normalizeComparable(leg.name);
    if (!normalized) return false;
    for (const token of tokens) {
      if (normalized.includes(token)) return true;
    }
    return false;
  });
}

function tripHasPlatform(trip: OvNlTripSummary, normalizedPlatform: string): boolean {
  if (!normalizedPlatform) return false;
  return trip.legs.some((leg) => {
    const values = [
      leg.originActualTrack,
      leg.originPlannedTrack,
      leg.destinationActualTrack,
      leg.destinationPlannedTrack,
    ];
    return values.some((value) => normalizeComparable(String(value ?? "")) === normalizedPlatform);
  });
}

function boardRowDateMs(row: BoardRow): number | null {
  return parseDateTimeMs(row.actualDateTime || row.plannedDateTime);
}

function boardRowIsRealtime(row: BoardRow): boolean {
  return Boolean(row.actualDateTime && row.actualDateTime !== row.plannedDateTime);
}

function boardRowPlatform(row: BoardRow): string {
  return normalizeComparable(row.actualTrack || row.plannedTrack || "");
}

function boardRowCounterpartyName(row: BoardRow): string {
  if ("destination" in row) return row.destination;
  return row.origin;
}

function buildIntentMeta(input: {
  intent: OvNlIntent | undefined;
  appliedHard: string[];
  appliedSoft: OvNlIntentRank[];
  ignoredSoft: OvNlIntentRank[];
  beforeCount: number;
  afterCount: number;
}): OvNlIntentMeta | undefined {
  if (!hasIntentPayload(input.intent)) return undefined;
  return {
    appliedHard: input.appliedHard,
    appliedSoft: input.appliedSoft,
    ignoredSoft: input.ignoredSoft,
    beforeCount: input.beforeCount,
    afterCount: input.afterCount,
  };
}

function resolveUnsupportedHardKeys(input: {
  hard: OvNlIntentHard | undefined;
  allowed: readonly OvNlIntentHardKey[];
}): OvNlIntentHardKey[] {
  const present = presentHardKeys(input.hard);
  const allowedSet = new Set(input.allowed);
  return present.filter((key) => !allowedSet.has(key));
}

function allowedHardKeysForAction(action: OvNlToolAction): readonly OvNlIntentHardKey[] {
  switch (action) {
    case "departures.list":
    case "departures.window":
    case "arrivals.list":
      return [
        "departureAfter",
        "departureBefore",
        "arrivalAfter",
        "arrivalBefore",
        "includeOperators",
        "excludeOperators",
        "includeTrainCategories",
        "excludeTrainCategories",
        "avoidStations",
        "excludeCancelled",
        "requireRealtime",
        "platformEquals",
      ];
    case "trips.search":
      return [
        "directOnly",
        "maxTransfers",
        "maxDurationMinutes",
        "departureAfter",
        "departureBefore",
        "arrivalAfter",
        "arrivalBefore",
        "includeModes",
        "excludeModes",
        "includeOperators",
        "excludeOperators",
        "includeTrainCategories",
        "excludeTrainCategories",
        "avoidStations",
        "excludeCancelled",
        "requireRealtime",
        "platformEquals",
      ];
    case "disruptions.list":
    case "disruptions.by_station":
      return ["disruptionTypes", "activeOnly"];
    default:
      return [];
  }
}

function sanitizeInputIntentForAction(
  input: z.infer<typeof OvNlGatewayToolValidatedInputSchema>
): {
  sanitized: z.infer<typeof OvNlGatewayToolValidatedInputSchema>;
  droppedHardConstraints: OvNlIntentHardKey[];
} {
  const hard = input.args.intent?.hard;
  const allowed = allowedHardKeysForAction(input.action);
  const droppedHardConstraints = resolveUnsupportedHardKeys({
    hard,
    allowed,
  });
  if (droppedHardConstraints.length === 0) {
    return { sanitized: input, droppedHardConstraints: [] };
  }

  const sanitized = structuredClone(input);
  const intent = sanitized.args.intent as OvNlIntent | undefined;
  if (intent?.hard) {
    const allowedSet = new Set(allowed);
    const hardPayload = intent.hard as Partial<Record<OvNlIntentHardKey, unknown>>;
    for (const key of OV_NL_INTENT_HARD_KEYS) {
      if (!allowedSet.has(key)) delete hardPayload[key];
    }
    if (presentHardKeys(intent.hard).length === 0) {
      delete (intent as { hard?: OvNlIntentHard }).hard;
    }
    if (!intent.hard && !intent.soft) {
      delete (sanitized.args as { intent?: OvNlIntent }).intent;
    }
  }

  return { sanitized, droppedHardConstraints };
}

function buildUnsupportedHardError(input: {
  action: OvNlToolAction;
  unsupported: OvNlIntentHardKey[];
  allowed: readonly OvNlIntentHardKey[];
}): OvNlActionExecutionResult {
  return {
    output: makeErrorOutput({
      action: input.action,
      code: "invalid_tool_input",
      message: `Some hard intent constraints are not supported for action "${input.action}": ${input.unsupported.join(
        ", "
      )}`,
      details: {
        unsupportedHardConstraints: input.unsupported,
        supportedHardConstraints: input.allowed,
      },
    }),
    cacheTtlSeconds: null,
  };
}

function suggestedRelaxationsForHard(appliedHard: string[]): string[] {
  const hints: string[] = [];
  for (const key of appliedHard) {
    if (key === "directOnly") hints.push("Allow 1 transfer instead of direct only.");
    if (key === "maxTransfers") hints.push("Increase maxTransfers.");
    if (key === "maxDurationMinutes") hints.push("Increase maxDurationMinutes.");
    if (key === "departureAfter") hints.push("Use an earlier departureAfter time.");
    if (key === "departureBefore") hints.push("Use a later departureBefore time.");
    if (key === "arrivalAfter") hints.push("Use an earlier arrivalAfter time.");
    if (key === "arrivalBefore") hints.push("Use a later arrivalBefore time.");
    if (key === "includeModes") hints.push("Allow more transport modes.");
    if (key === "excludeModes") hints.push("Exclude fewer transport modes.");
    if (key === "includeOperators") hints.push("Allow more operators.");
    if (key === "excludeOperators") hints.push("Exclude fewer operators.");
    if (key === "includeTrainCategories") hints.push("Allow more train categories.");
    if (key === "excludeTrainCategories") hints.push("Exclude fewer train categories.");
    if (key === "avoidStations") hints.push("Avoid fewer stations.");
    if (key === "excludeCancelled") hints.push("Allow cancelled services in results.");
    if (key === "requireRealtime") hints.push("Allow non-realtime services.");
    if (key === "platformEquals") hints.push("Remove fixed platform requirement.");
    if (key === "disruptionTypes") hints.push("Allow more disruption types.");
    if (key === "activeOnly") hints.push("Allow inactive disruptions.");
  }
  return Array.from(new Set(hints));
}

function buildConstraintNoMatchError(input: {
  action: OvNlToolAction;
  appliedHard: string[];
  beforeCount: number;
  afterCount: number;
}): OvNlActionExecutionResult {
  return {
    output: makeErrorOutput({
      action: input.action,
      code: "constraint_no_match",
      message: "No results match all required constraints. Please relax at least one hard constraint.",
      details: {
        appliedHard: input.appliedHard,
        beforeCount: input.beforeCount,
        afterCount: input.afterCount,
        suggestedRelaxations: suggestedRelaxationsForHard(input.appliedHard),
      },
    }),
    cacheTtlSeconds: null,
  };
}

type TripsHardFilterResult =
  | {
      ok: true;
      trips: OvNlTripSummary[];
      appliedHard: string[];
    }
  | {
      ok: false;
      error: OvNlToolError;
    };

function isStrictDirectOnlyRequested(hard: OvNlIntentHard | undefined): boolean {
  if (!hard) return false;
  if (hard.directOnly === true) return true;
  if (typeof hard.maxTransfers === "number" && Number.isFinite(hard.maxTransfers)) {
    return hard.maxTransfers <= 0;
  }
  return false;
}

function requestedHardKeysFromIntent(intent: OvNlIntent | undefined): string[] {
  const hard = intent?.hard;
  if (!hard || typeof hard !== "object") return [];
  return presentHardKeys(hard as OvNlIntentHard);
}

function requestedDirectOnlyFromIntent(intent: OvNlIntent | undefined): boolean {
  const hard = intent?.hard;
  if (!hard || typeof hard !== "object") return false;
  return isStrictDirectOnlyRequested(hard as OvNlIntentHard);
}

function removeStrictDirectOnlyConstraints(hard: OvNlIntentHard | undefined): OvNlIntentHard | undefined {
  if (!hard) return undefined;
  const next: OvNlIntentHard = { ...hard };
  delete (next as Record<string, unknown>).directOnly;
  delete (next as Record<string, unknown>).maxTransfers;

  const hasRemaining = OV_NL_INTENT_HARD_KEYS.some((key) =>
    hasOwnKey(next, key) ? hasMeaningfulHardValue(next[key]) : false
  );
  return hasRemaining ? next : undefined;
}

function applyTripsHardConstraints(input: {
  trips: OvNlTripSummary[];
  hard: OvNlIntentHard | undefined;
  nowMs: number;
}): TripsHardFilterResult {
  const hard = input.hard;
  let filteredTrips = input.trips.slice();
  const appliedHard: string[] = [];

  if (hard?.directOnly) {
    appliedHard.push("directOnly");
    filteredTrips = filteredTrips.filter((trip) => trip.transfers === 0);
  }

  if (typeof hard?.maxTransfers === "number" && Number.isFinite(hard.maxTransfers)) {
    appliedHard.push("maxTransfers");
    filteredTrips = filteredTrips.filter((trip) => trip.transfers <= hard.maxTransfers!);
  }

  if (
    typeof hard?.maxDurationMinutes === "number" &&
    Number.isFinite(hard.maxDurationMinutes)
  ) {
    appliedHard.push("maxDurationMinutes");
    filteredTrips = filteredTrips.filter((trip) => {
      const duration = tripDurationMinutes(trip);
      return duration == null || duration <= hard.maxDurationMinutes!;
    });
  }

  const depAfter = resolveIntentDateConstraintMs({
    raw: hard?.departureAfter,
    nowMs: input.nowMs,
    key: "departureAfter",
  });
  if (!depAfter.ok) return { ok: false, error: depAfter.error };
  const depAfterMs = depAfter.ms;
  if (depAfterMs != null) {
    appliedHard.push("departureAfter");
    filteredTrips = filteredTrips.filter((trip) => {
      const dt = firstTripDepartureMs(trip);
      return dt == null || dt >= depAfterMs;
    });
  }

  const depBefore = resolveIntentDateConstraintMs({
    raw: hard?.departureBefore,
    nowMs: input.nowMs,
    key: "departureBefore",
  });
  if (!depBefore.ok) return { ok: false, error: depBefore.error };
  const depBeforeMs = depBefore.ms;
  if (depBeforeMs != null) {
    appliedHard.push("departureBefore");
    filteredTrips = filteredTrips.filter((trip) => {
      const dt = firstTripDepartureMs(trip);
      return dt == null || dt <= depBeforeMs;
    });
  }

  const arrAfter = resolveIntentDateConstraintMs({
    raw: hard?.arrivalAfter,
    nowMs: input.nowMs,
    key: "arrivalAfter",
  });
  if (!arrAfter.ok) return { ok: false, error: arrAfter.error };
  const arrAfterMs = arrAfter.ms;
  if (arrAfterMs != null) {
    appliedHard.push("arrivalAfter");
    filteredTrips = filteredTrips.filter((trip) => {
      const dt = finalTripArrivalMs(trip);
      return dt == null || dt >= arrAfterMs;
    });
  }

  const arrBefore = resolveIntentDateConstraintMs({
    raw: hard?.arrivalBefore,
    nowMs: input.nowMs,
    key: "arrivalBefore",
  });
  if (!arrBefore.ok) return { ok: false, error: arrBefore.error };
  const arrBeforeMs = arrBefore.ms;
  if (arrBeforeMs != null) {
    appliedHard.push("arrivalBefore");
    filteredTrips = filteredTrips.filter((trip) => {
      const dt = finalTripArrivalMs(trip);
      return dt == null || dt <= arrBeforeMs;
    });
  }

  const includeModes = normalizeModeSet(hard?.includeModes);
  if (includeModes.size > 0) {
    appliedHard.push("includeModes");
    filteredTrips = filteredTrips.filter((trip) =>
      trip.legs.some((leg) => includeModes.has(leg.mode))
    );
  }

  const excludeModes = normalizeModeSet(hard?.excludeModes);
  if (excludeModes.size > 0) {
    appliedHard.push("excludeModes");
    filteredTrips = filteredTrips.filter(
      (trip) => !trip.legs.some((leg) => excludeModes.has(leg.mode))
    );
  }

  const includeOperators = normalizeStringSet(hard?.includeOperators);
  if (includeOperators.size > 0) {
    appliedHard.push("includeOperators");
    filteredTrips = filteredTrips.filter((trip) =>
      tripMatchesOperatorTokens(trip, includeOperators)
    );
  }

  const excludeOperators = normalizeStringSet(hard?.excludeOperators);
  if (excludeOperators.size > 0) {
    appliedHard.push("excludeOperators");
    filteredTrips = filteredTrips.filter(
      (trip) => !tripMatchesOperatorTokens(trip, excludeOperators)
    );
  }

  const includeCategories = normalizeStringSet(hard?.includeTrainCategories);
  if (includeCategories.size > 0) {
    appliedHard.push("includeTrainCategories");
    filteredTrips = filteredTrips.filter((trip) =>
      tripMatchesCategoryTokens(trip, includeCategories)
    );
  }

  const excludeCategories = normalizeStringSet(hard?.excludeTrainCategories);
  if (excludeCategories.size > 0) {
    appliedHard.push("excludeTrainCategories");
    filteredTrips = filteredTrips.filter(
      (trip) => !tripMatchesCategoryTokens(trip, excludeCategories)
    );
  }

  const avoidStations = normalizeStringSet(hard?.avoidStations);
  if (avoidStations.size > 0) {
    appliedHard.push("avoidStations");
    filteredTrips = filteredTrips.filter((trip) => !tripTouchesStation(trip, avoidStations));
  }

  if (hard?.excludeCancelled) {
    appliedHard.push("excludeCancelled");
    filteredTrips = filteredTrips.filter((trip) => !trip.legs.some((leg) => leg.cancelled));
  }

  if (hard?.requireRealtime) {
    appliedHard.push("requireRealtime");
    filteredTrips = filteredTrips.filter((trip) => trip.realtime);
  }

  const normalizedPlatform = normalizeComparable(hard?.platformEquals ?? "");
  if (normalizedPlatform) {
    appliedHard.push("platformEquals");
    filteredTrips = filteredTrips.filter((trip) => tripHasPlatform(trip, normalizedPlatform));
  }

  return {
    ok: true,
    trips: filteredTrips,
    appliedHard,
  };
}

function sortTripsBySoftRanks(trips: OvNlTripSummary[], ranks: OvNlIntentRank[]): OvNlTripSummary[] {
  if (ranks.length === 0) return trips;
  return stableSort(trips, (a, b) => {
    for (const rank of ranks) {
      if (rank === "fastest") {
        const cmp = compareNullableNumberAsc(tripDurationMinutes(a), tripDurationMinutes(b));
        if (cmp !== 0) return cmp;
      } else if (rank === "fewest_transfers") {
        const cmp = a.transfers - b.transfers;
        if (cmp !== 0) return cmp;
      } else if (rank === "earliest_departure") {
        const cmp = compareNullableNumberAsc(firstTripDepartureMs(a), firstTripDepartureMs(b));
        if (cmp !== 0) return cmp;
      } else if (rank === "earliest_arrival") {
        const cmp = compareNullableNumberAsc(finalTripArrivalMs(a), finalTripArrivalMs(b));
        if (cmp !== 0) return cmp;
      } else if (rank === "realtime_first") {
        if (a.realtime !== b.realtime) return a.realtime ? -1 : 1;
      } else if (rank === "least_walking") {
        const cmp = tripWalkingLegCount(a) - tripWalkingLegCount(b);
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  });
}

function sortBoardRowsBySoftRanks(rows: BoardRow[], ranks: OvNlIntentRank[]): BoardRow[] {
  if (ranks.length === 0) return rows;
  return stableSort(rows, (a, b) => {
    for (const rank of ranks) {
      if (rank === "earliest_departure" || rank === "earliest_arrival") {
        const cmp = compareNullableNumberAsc(boardRowDateMs(a), boardRowDateMs(b));
        if (cmp !== 0) return cmp;
      } else if (rank === "realtime_first") {
        const aRealtime = boardRowIsRealtime(a);
        const bRealtime = boardRowIsRealtime(b);
        if (aRealtime !== bRealtime) return aRealtime ? -1 : 1;
      }
    }
    return 0;
  });
}

function sortDisruptionsBySoftRanks(rows: OvNlDisruption[], ranks: OvNlIntentRank[]): OvNlDisruption[] {
  if (ranks.length === 0) return rows;
  return stableSort(rows, (a, b) => {
    for (const rank of ranks) {
      if (rank === "realtime_first") {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      }
    }
    return 0;
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

function nsCfgFromCtx(ctx: OvNlActionExecutionContext): NsClientConfig {
  return {
    baseUrls: ctx.cfg.baseUrls,
    timeoutMs: ctx.cfg.timeoutMs,
    subscriptionKey: ctx.subscriptionKey,
    cacheMaxTtlSeconds: ctx.cfg.cacheMaxTtlSeconds,
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

  const response = await nsStationsSearch({
    cfg: nsCfgFromCtx(ctx),
    query: input.query,
    limit,
    countryCodes,
  });
  if (!response.ok) return { ok: false, error: mapClientErrorToToolError(response.error) };
  ctx.ttlHints.push(response.ttlSeconds);

  const stations = response.payload.map((station) => normalizeStation(station)).filter((station) => {
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
  const intent = validatedInput.args.intent;
  const hard = intent?.hard;
  const softRanksAll = uniqueSoftRanks(intent?.soft);

  if (action === "stations.search") {
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: [],
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: [],
      });
    }
    const ignoredSoft = softRanksAll;

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
        intentMeta: buildIntentMeta({
          intent,
          appliedHard: [],
          appliedSoft: [],
          ignoredSoft,
          beforeCount: searched.stations.length,
          afterCount: searched.stations.length,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "stations.nearest") {
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: [],
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: [],
      });
    }
    const ignoredSoft = softRanksAll;

	    const lat = validatedInput.args.latitude ?? validatedInput.args.lat ?? 0;
	    const lng = validatedInput.args.longitude ?? validatedInput.args.lng ?? 0;
	    const limit = Math.max(1, Math.min(20, Math.floor(validatedInput.args.limit ?? 6)));

	    const response = await nsStationsNearest({
	      cfg: nsCfgFromCtx(ctx),
	      lat,
	      lng,
	      limit,
	    });
	    if (!response.ok) {
	      const error = mapClientErrorToToolError(response.error);
	      return {
	        output: makeErrorOutput({
	          action,
	          code: error.code,
	          message: error.message,
	          details: error.details,
	        }),
	        cacheTtlSeconds: null,
	      };
	    }
	    ctx.ttlHints.push(response.ttlSeconds);

	    const stations = response.payload.map((station) => normalizeStation(station));
	    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
	    return {
	      output: {
	        kind: "stations.nearest",
        latitude: lat,
        longitude: lng,
        stations,
        intentMeta: buildIntentMeta({
          intent,
          appliedHard: [],
          appliedSoft: [],
          ignoredSoft,
          beforeCount: stations.length,
          afterCount: stations.length,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "departures.window") {
    const allowedHard: readonly OvNlIntentHardKey[] = [
      "departureAfter",
      "departureBefore",
      "arrivalAfter",
      "arrivalBefore",
      "includeOperators",
      "excludeOperators",
      "includeTrainCategories",
      "excludeTrainCategories",
      "avoidStations",
      "excludeCancelled",
      "requireRealtime",
      "platformEquals",
    ];
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: allowedHard,
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: allowedHard,
      });
    }
    const { applied: appliedSoft, ignored: ignoredSoft } = partitionSoftRanks({
      all: softRanksAll,
      supported: ["earliest_departure", "realtime_first"],
    });

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
	      const response = await nsDepartures({
	        cfg: nsCfgFromCtx(ctx),
	        lang,
	        station: station.code || undefined,
	        uicCode: station.uicCode || undefined,
	        dateTime: new Date(cursorMs).toISOString(),
	        maxJourneys,
	      });
	      if (!response.ok) {
	        const error = mapClientErrorToToolError(response.error);
	        return {
	          output: makeErrorOutput({
	            action,
	            code: error.code,
	            message: error.message,
	            details: error.details,
	          }),
	          cacheTtlSeconds: null,
	        };
	      }
	      ctx.ttlHints.push(response.ttlSeconds);

	      const payload = response.payload;

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

    const appliedHard: string[] = [];
    let filteredDepartures = departures.slice();
    const depAfter = resolveIntentDateConstraintMs({
      raw: hard?.departureAfter,
      nowMs,
      key: "departureAfter",
    });
    if (!depAfter.ok) {
      return { output: makeErrorOutput({ action, ...depAfter.error }), cacheTtlSeconds: null };
    }
    const depAfterMs = depAfter.ms;
    if (depAfterMs != null) {
      appliedHard.push("departureAfter");
      filteredDepartures = filteredDepartures.filter((row) => {
        const dt = boardRowDateMs(row);
        return dt == null || dt >= depAfterMs;
      });
    }

    const depBefore = resolveIntentDateConstraintMs({
      raw: hard?.departureBefore,
      nowMs,
      key: "departureBefore",
    });
    if (!depBefore.ok) {
      return { output: makeErrorOutput({ action, ...depBefore.error }), cacheTtlSeconds: null };
    }
    const depBeforeMs = depBefore.ms;
    if (depBeforeMs != null) {
      appliedHard.push("departureBefore");
      filteredDepartures = filteredDepartures.filter((row) => {
        const dt = boardRowDateMs(row);
        return dt == null || dt <= depBeforeMs;
      });
    }

    const arrAfter = resolveIntentDateConstraintMs({
      raw: hard?.arrivalAfter,
      nowMs,
      key: "arrivalAfter",
    });
    if (!arrAfter.ok) {
      return { output: makeErrorOutput({ action, ...arrAfter.error }), cacheTtlSeconds: null };
    }
    const arrAfterMs = arrAfter.ms;
    if (arrAfterMs != null) {
      appliedHard.push("arrivalAfter");
      filteredDepartures = filteredDepartures.filter((row) => {
        const dt = boardRowDateMs(row);
        return dt == null || dt >= arrAfterMs;
      });
    }

    const arrBefore = resolveIntentDateConstraintMs({
      raw: hard?.arrivalBefore,
      nowMs,
      key: "arrivalBefore",
    });
    if (!arrBefore.ok) {
      return { output: makeErrorOutput({ action, ...arrBefore.error }), cacheTtlSeconds: null };
    }
    const arrBeforeMs = arrBefore.ms;
    if (arrBeforeMs != null) {
      appliedHard.push("arrivalBefore");
      filteredDepartures = filteredDepartures.filter((row) => {
        const dt = boardRowDateMs(row);
        return dt == null || dt <= arrBeforeMs;
      });
    }

    if (hard?.excludeCancelled) {
      appliedHard.push("excludeCancelled");
      filteredDepartures = filteredDepartures.filter((row) => !row.cancelled);
    }

    if (hard?.requireRealtime) {
      appliedHard.push("requireRealtime");
      filteredDepartures = filteredDepartures.filter((row) => boardRowIsRealtime(row));
    }

    const includeOperators = normalizeStringSet(hard?.includeOperators);
    if (includeOperators.size > 0) {
      appliedHard.push("includeOperators");
      filteredDepartures = filteredDepartures.filter((row) => {
        const normalized = normalizeComparable(row.operatorName ?? "");
        if (!normalized) return false;
        for (const token of includeOperators) {
          if (normalized.includes(token)) return true;
        }
        return false;
      });
    }

    const excludeOperators = normalizeStringSet(hard?.excludeOperators);
    if (excludeOperators.size > 0) {
      appliedHard.push("excludeOperators");
      filteredDepartures = filteredDepartures.filter((row) => {
        const normalized = normalizeComparable(row.operatorName ?? "");
        if (!normalized) return true;
        for (const token of excludeOperators) {
          if (normalized.includes(token)) return false;
        }
        return true;
      });
    }

    const includeCategories = normalizeStringSet(hard?.includeTrainCategories);
    if (includeCategories.size > 0) {
      appliedHard.push("includeTrainCategories");
      filteredDepartures = filteredDepartures.filter((row) => {
        const normalized = normalizeComparable(row.trainCategory);
        if (!normalized) return false;
        for (const token of includeCategories) {
          if (normalized.includes(token)) return true;
        }
        return false;
      });
    }

    const excludeCategories = normalizeStringSet(hard?.excludeTrainCategories);
    if (excludeCategories.size > 0) {
      appliedHard.push("excludeTrainCategories");
      filteredDepartures = filteredDepartures.filter((row) => {
        const normalized = normalizeComparable(row.trainCategory);
        for (const token of excludeCategories) {
          if (normalized.includes(token)) return false;
        }
        return true;
      });
    }

    const avoidStations = normalizeStringSet(hard?.avoidStations);
    if (avoidStations.size > 0) {
      appliedHard.push("avoidStations");
      filteredDepartures = filteredDepartures.filter(
        (row) => !avoidStations.has(normalizeComparable(row.destination))
      );
    }

    const normalizedPlatform = normalizeComparable(hard?.platformEquals ?? "");
    if (normalizedPlatform) {
      appliedHard.push("platformEquals");
      filteredDepartures = filteredDepartures.filter(
        (row) => boardRowPlatform(row) === normalizedPlatform
      );
    }

    if (filteredDepartures.length === 0 && appliedHard.length > 0) {
      return buildConstraintNoMatchError({
        action,
        appliedHard,
        beforeCount: departures.length,
        afterCount: 0,
      });
    }

    const rankedDepartures = sortBoardRowsBySoftRanks(filteredDepartures, appliedSoft);

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
        departures: rankedDepartures as OvNlDeparture[],
        intentMeta: buildIntentMeta({
          intent,
          appliedHard,
          appliedSoft,
          ignoredSoft,
          beforeCount: departures.length,
          afterCount: rankedDepartures.length,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "departures.list" || action === "arrivals.list") {
    const allowedHard: readonly OvNlIntentHardKey[] = [
      "departureAfter",
      "departureBefore",
      "arrivalAfter",
      "arrivalBefore",
      "includeOperators",
      "excludeOperators",
      "includeTrainCategories",
      "excludeTrainCategories",
      "avoidStations",
      "excludeCancelled",
      "requireRealtime",
      "platformEquals",
    ];
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: allowedHard,
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: allowedHard,
      });
    }
    const { applied: appliedSoft, ignored: ignoredSoft } = partitionSoftRanks({
      all: softRanksAll,
      supported:
        action === "departures.list"
          ? (["earliest_departure", "realtime_first"] as const)
          : (["earliest_arrival", "realtime_first"] as const),
    });

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
	    const response =
	      action === "departures.list"
	        ? await nsDepartures({
	            cfg: nsCfgFromCtx(ctx),
	            lang,
	            station: station.code || undefined,
	            uicCode: station.uicCode || undefined,
	            dateTime: normalizeDateTimeInput(validatedInput.args.dateTime),
	            maxJourneys: validatedInput.args.maxJourneys ?? 40,
	          })
	        : await nsArrivals({
	            cfg: nsCfgFromCtx(ctx),
	            lang,
	            station: station.code || undefined,
	            uicCode: station.uicCode || undefined,
	            dateTime: normalizeDateTimeInput(validatedInput.args.dateTime),
	            maxJourneys: validatedInput.args.maxJourneys ?? 40,
	          });

	    if (!response.ok) {
	      const error = mapClientErrorToToolError(response.error);
	      return {
	        output: makeErrorOutput({
	          action,
	          code: error.code,
	          message: error.message,
	          details: error.details,
	        }),
	        cacheTtlSeconds: null,
	      };
	    }
	    ctx.ttlHints.push(response.ttlSeconds);

	    const payload = response.payload;

	    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
	    if (action === "departures.list") {
	      const departuresRaw = Array.isArray(payload.departures) ? payload.departures : [];
	      const baseDepartures = departuresRaw.map((departure, index) => normalizeDeparture(departure, index));
      const nowMs = Date.now();
      const appliedHard: string[] = [];
      let filteredRows: BoardRow[] = baseDepartures.slice();

      const depAfter = resolveIntentDateConstraintMs({
        raw: hard?.departureAfter,
        nowMs,
        key: "departureAfter",
      });
      if (!depAfter.ok) {
        return { output: makeErrorOutput({ action, ...depAfter.error }), cacheTtlSeconds: null };
      }
      const depAfterMs = depAfter.ms;
      if (depAfterMs != null) {
        appliedHard.push("departureAfter");
        filteredRows = filteredRows.filter((row) => {
          const dt = boardRowDateMs(row);
          return dt == null || dt >= depAfterMs;
        });
      }

      const depBefore = resolveIntentDateConstraintMs({
        raw: hard?.departureBefore,
        nowMs,
        key: "departureBefore",
      });
      if (!depBefore.ok) {
        return { output: makeErrorOutput({ action, ...depBefore.error }), cacheTtlSeconds: null };
      }
      const depBeforeMs = depBefore.ms;
      if (depBeforeMs != null) {
        appliedHard.push("departureBefore");
        filteredRows = filteredRows.filter((row) => {
          const dt = boardRowDateMs(row);
          return dt == null || dt <= depBeforeMs;
        });
      }

      const arrAfter = resolveIntentDateConstraintMs({
        raw: hard?.arrivalAfter,
        nowMs,
        key: "arrivalAfter",
      });
      if (!arrAfter.ok) {
        return { output: makeErrorOutput({ action, ...arrAfter.error }), cacheTtlSeconds: null };
      }
      const arrAfterMs = arrAfter.ms;
      if (arrAfterMs != null) {
        appliedHard.push("arrivalAfter");
        filteredRows = filteredRows.filter((row) => {
          const dt = boardRowDateMs(row);
          return dt == null || dt >= arrAfterMs;
        });
      }

      const arrBefore = resolveIntentDateConstraintMs({
        raw: hard?.arrivalBefore,
        nowMs,
        key: "arrivalBefore",
      });
      if (!arrBefore.ok) {
        return { output: makeErrorOutput({ action, ...arrBefore.error }), cacheTtlSeconds: null };
      }
      const arrBeforeMs = arrBefore.ms;
      if (arrBeforeMs != null) {
        appliedHard.push("arrivalBefore");
        filteredRows = filteredRows.filter((row) => {
          const dt = boardRowDateMs(row);
          return dt == null || dt <= arrBeforeMs;
        });
      }

      if (hard?.excludeCancelled) {
        appliedHard.push("excludeCancelled");
        filteredRows = filteredRows.filter((row) => !row.cancelled);
      }
      if (hard?.requireRealtime) {
        appliedHard.push("requireRealtime");
        filteredRows = filteredRows.filter((row) => boardRowIsRealtime(row));
      }

      const includeOperators = normalizeStringSet(hard?.includeOperators);
      if (includeOperators.size > 0) {
        appliedHard.push("includeOperators");
        filteredRows = filteredRows.filter((row) => {
          const normalized = normalizeComparable(row.operatorName ?? "");
          if (!normalized) return false;
          for (const token of includeOperators) {
            if (normalized.includes(token)) return true;
          }
          return false;
        });
      }

      const excludeOperators = normalizeStringSet(hard?.excludeOperators);
      if (excludeOperators.size > 0) {
        appliedHard.push("excludeOperators");
        filteredRows = filteredRows.filter((row) => {
          const normalized = normalizeComparable(row.operatorName ?? "");
          if (!normalized) return true;
          for (const token of excludeOperators) {
            if (normalized.includes(token)) return false;
          }
          return true;
        });
      }

      const includeCategories = normalizeStringSet(hard?.includeTrainCategories);
      if (includeCategories.size > 0) {
        appliedHard.push("includeTrainCategories");
        filteredRows = filteredRows.filter((row) => {
          const normalized = normalizeComparable(row.trainCategory);
          if (!normalized) return false;
          for (const token of includeCategories) {
            if (normalized.includes(token)) return true;
          }
          return false;
        });
      }

      const excludeCategories = normalizeStringSet(hard?.excludeTrainCategories);
      if (excludeCategories.size > 0) {
        appliedHard.push("excludeTrainCategories");
        filteredRows = filteredRows.filter((row) => {
          const normalized = normalizeComparable(row.trainCategory);
          for (const token of excludeCategories) {
            if (normalized.includes(token)) return false;
          }
          return true;
        });
      }

      const avoidStations = normalizeStringSet(hard?.avoidStations);
      if (avoidStations.size > 0) {
        appliedHard.push("avoidStations");
        filteredRows = filteredRows.filter(
          (row) => !avoidStations.has(normalizeComparable(boardRowCounterpartyName(row)))
        );
      }

      const normalizedPlatform = normalizeComparable(hard?.platformEquals ?? "");
      if (normalizedPlatform) {
        appliedHard.push("platformEquals");
        filteredRows = filteredRows.filter((row) => boardRowPlatform(row) === normalizedPlatform);
      }

      if (filteredRows.length === 0 && appliedHard.length > 0) {
        return buildConstraintNoMatchError({
          action,
          appliedHard,
          beforeCount: baseDepartures.length,
          afterCount: 0,
        });
      }
      const rankedRows = sortBoardRowsBySoftRanks(filteredRows, appliedSoft) as OvNlDeparture[];
      return {
        output: {
          kind: "departures.list",
          station,
          departures: rankedRows,
          intentMeta: buildIntentMeta({
            intent,
            appliedHard,
            appliedSoft,
            ignoredSoft,
            beforeCount: baseDepartures.length,
            afterCount: rankedRows.length,
          }),
          cacheTtlSeconds,
          fetchedAt,
          cached: false,
        },
        cacheTtlSeconds,
      };
    }

    const arrivalsRaw = Array.isArray(payload.arrivals) ? payload.arrivals : [];
    const baseArrivals = arrivalsRaw.map((arrival, index) => normalizeArrival(arrival, index));
    const nowMs = Date.now();
    const appliedHard: string[] = [];
    let filteredRows: BoardRow[] = baseArrivals.slice();

    const depAfter = resolveIntentDateConstraintMs({
      raw: hard?.departureAfter,
      nowMs,
      key: "departureAfter",
    });
    if (!depAfter.ok) {
      return { output: makeErrorOutput({ action, ...depAfter.error }), cacheTtlSeconds: null };
    }
    const depAfterMs = depAfter.ms;
    if (depAfterMs != null) {
      appliedHard.push("departureAfter");
      filteredRows = filteredRows.filter((row) => {
        const dt = boardRowDateMs(row);
        return dt == null || dt >= depAfterMs;
      });
    }

    const depBefore = resolveIntentDateConstraintMs({
      raw: hard?.departureBefore,
      nowMs,
      key: "departureBefore",
    });
    if (!depBefore.ok) {
      return { output: makeErrorOutput({ action, ...depBefore.error }), cacheTtlSeconds: null };
    }
    const depBeforeMs = depBefore.ms;
    if (depBeforeMs != null) {
      appliedHard.push("departureBefore");
      filteredRows = filteredRows.filter((row) => {
        const dt = boardRowDateMs(row);
        return dt == null || dt <= depBeforeMs;
      });
    }

    const arrAfter = resolveIntentDateConstraintMs({
      raw: hard?.arrivalAfter,
      nowMs,
      key: "arrivalAfter",
    });
    if (!arrAfter.ok) {
      return { output: makeErrorOutput({ action, ...arrAfter.error }), cacheTtlSeconds: null };
    }
    const arrAfterMs = arrAfter.ms;
    if (arrAfterMs != null) {
      appliedHard.push("arrivalAfter");
      filteredRows = filteredRows.filter((row) => {
        const dt = boardRowDateMs(row);
        return dt == null || dt >= arrAfterMs;
      });
    }

    const arrBefore = resolveIntentDateConstraintMs({
      raw: hard?.arrivalBefore,
      nowMs,
      key: "arrivalBefore",
    });
    if (!arrBefore.ok) {
      return { output: makeErrorOutput({ action, ...arrBefore.error }), cacheTtlSeconds: null };
    }
    const arrBeforeMs = arrBefore.ms;
    if (arrBeforeMs != null) {
      appliedHard.push("arrivalBefore");
      filteredRows = filteredRows.filter((row) => {
        const dt = boardRowDateMs(row);
        return dt == null || dt <= arrBeforeMs;
      });
    }

    if (hard?.excludeCancelled) {
      appliedHard.push("excludeCancelled");
      filteredRows = filteredRows.filter((row) => !row.cancelled);
    }
    if (hard?.requireRealtime) {
      appliedHard.push("requireRealtime");
      filteredRows = filteredRows.filter((row) => boardRowIsRealtime(row));
    }

    const includeOperators = normalizeStringSet(hard?.includeOperators);
    if (includeOperators.size > 0) {
      appliedHard.push("includeOperators");
      filteredRows = filteredRows.filter((row) => {
        const normalized = normalizeComparable(row.operatorName ?? "");
        if (!normalized) return false;
        for (const token of includeOperators) {
          if (normalized.includes(token)) return true;
        }
        return false;
      });
    }

    const excludeOperators = normalizeStringSet(hard?.excludeOperators);
    if (excludeOperators.size > 0) {
      appliedHard.push("excludeOperators");
      filteredRows = filteredRows.filter((row) => {
        const normalized = normalizeComparable(row.operatorName ?? "");
        if (!normalized) return true;
        for (const token of excludeOperators) {
          if (normalized.includes(token)) return false;
        }
        return true;
      });
    }

    const includeCategories = normalizeStringSet(hard?.includeTrainCategories);
    if (includeCategories.size > 0) {
      appliedHard.push("includeTrainCategories");
      filteredRows = filteredRows.filter((row) => {
        const normalized = normalizeComparable(row.trainCategory);
        if (!normalized) return false;
        for (const token of includeCategories) {
          if (normalized.includes(token)) return true;
        }
        return false;
      });
    }

    const excludeCategories = normalizeStringSet(hard?.excludeTrainCategories);
    if (excludeCategories.size > 0) {
      appliedHard.push("excludeTrainCategories");
      filteredRows = filteredRows.filter((row) => {
        const normalized = normalizeComparable(row.trainCategory);
        for (const token of excludeCategories) {
          if (normalized.includes(token)) return false;
        }
        return true;
      });
    }

    const avoidStations = normalizeStringSet(hard?.avoidStations);
    if (avoidStations.size > 0) {
      appliedHard.push("avoidStations");
      filteredRows = filteredRows.filter(
        (row) => !avoidStations.has(normalizeComparable(boardRowCounterpartyName(row)))
      );
    }

    const normalizedPlatform = normalizeComparable(hard?.platformEquals ?? "");
    if (normalizedPlatform) {
      appliedHard.push("platformEquals");
      filteredRows = filteredRows.filter((row) => boardRowPlatform(row) === normalizedPlatform);
    }

    if (filteredRows.length === 0 && appliedHard.length > 0) {
      return buildConstraintNoMatchError({
        action,
        appliedHard,
        beforeCount: baseArrivals.length,
        afterCount: 0,
      });
    }
    const rankedRows = sortBoardRowsBySoftRanks(filteredRows, appliedSoft) as OvNlArrival[];
    return {
      output: {
        kind: "arrivals.list",
        station,
        arrivals: rankedRows,
        intentMeta: buildIntentMeta({
          intent,
          appliedHard,
          appliedSoft,
          ignoredSoft,
          beforeCount: baseArrivals.length,
          afterCount: rankedRows.length,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "trips.search") {
    const allowedHard: readonly OvNlIntentHardKey[] = [
      "directOnly",
      "maxTransfers",
      "maxDurationMinutes",
      "departureAfter",
      "departureBefore",
      "arrivalAfter",
      "arrivalBefore",
      "includeModes",
      "excludeModes",
      "includeOperators",
      "excludeOperators",
      "includeTrainCategories",
      "excludeTrainCategories",
      "avoidStations",
      "excludeCancelled",
      "requireRealtime",
      "platformEquals",
    ];
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: allowedHard,
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: allowedHard,
      });
    }
    const { applied: appliedSoft, ignored: ignoredSoft } = partitionSoftRanks({
      all: softRanksAll,
      supported: [
        "fastest",
        "fewest_transfers",
        "earliest_departure",
        "earliest_arrival",
        "realtime_first",
        "least_walking",
      ],
    });

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
	    const response = await nsTripsSearch({
	      cfg: nsCfgFromCtx(ctx),
	      lang,
	      fromStation: fromResolved.station.code,
	      toStation: toResolved.station.code,
	      viaStation: via?.code || undefined,
	      dateTime: effectiveDateTime,
	      searchForArrival: validatedInput.args.searchForArrival,
	    });
	    if (!response.ok) {
	      const error = mapClientErrorToToolError(response.error);
	      return {
	        output: makeErrorOutput({
	          action,
	          code: error.code,
	          message: error.message,
	          details: error.details,
	        }),
	        cacheTtlSeconds: null,
	      };
	    }
	    ctx.ttlHints.push(response.ttlSeconds);

	    const advices = response.payload;

	    const limit = Math.max(1, Math.min(20, Math.floor(validatedInput.args.limit ?? 8)));
	    const allTrips = advices
	      .flatMap((advice) => {
	        const adviceObj = advice;
        const source = asText(adviceObj.source);
        const tripsRaw = Array.isArray(adviceObj.trips) ? adviceObj.trips : [];
        return tripsRaw.map((trip) => normalizeTripSummary(trip, source));
      });

    const normalizedTrips = filterDepartedTrips(allTrips, nowMs);
    const hardConstraintResult = applyTripsHardConstraints({
      trips: normalizedTrips,
      hard,
      nowMs,
    });
    if (!hardConstraintResult.ok) {
      return {
        output: makeErrorOutput({ action, ...hardConstraintResult.error }),
        cacheTtlSeconds: null,
      };
    }

    const appliedHard = hardConstraintResult.appliedHard;
    const strictDirectOnlyRequested = isStrictDirectOnlyRequested(hard);
    const alternativeRanks: OvNlIntentRank[] = [
      "fewest_transfers",
      ...appliedSoft.filter((rank) => rank !== "fewest_transfers"),
    ];

    if (hardConstraintResult.trips.length === 0 && appliedHard.length > 0) {
      if (strictDirectOnlyRequested && normalizedTrips.length > 0) {
        const relaxedHard = removeStrictDirectOnlyConstraints(hard);
        const relaxedResult = applyTripsHardConstraints({
          trips: normalizedTrips,
          hard: relaxedHard,
          nowMs,
        });
        if (!relaxedResult.ok) {
          return {
            output: makeErrorOutput({ action, ...relaxedResult.error }),
            cacheTtlSeconds: null,
          };
        }

        const transferCandidates = relaxedResult.trips.filter(
          (trip) => typeof trip.transfers === "number" && Number.isFinite(trip.transfers) && trip.transfers > 0
        );
        if (transferCandidates.length > 0) {
          const minTransfers = transferCandidates.reduce(
            (best, trip) => Math.min(best, trip.transfers),
            Number.POSITIVE_INFINITY
          );
          const rankedTransferCandidates = sortTripsBySoftRanks(transferCandidates, alternativeRanks).filter(
            (trip) => trip.transfers === minTransfers
          );
          const alternativeTrips = rankedTransferCandidates.slice(0, limit);

		          if (alternativeTrips.length > 0) {
		            const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
		            const requestedHardKeys = requestedHardKeysFromIntent(intent);
		            const requestedDirectOnly = requestedDirectOnlyFromIntent(intent);
		            const recommendedTripUid = alternativeTrips[0]?.uid ?? "";
		            const query = {
		              from: validatedInput.args.from,
		              to: validatedInput.args.to,
		              via: validatedInput.args.via,
		              dateTime: effectiveDateTime,
		              searchForArrival: validatedInput.args.searchForArrival,
		              limit,
		              lang,
		              intent,
		            };
		            const page = { hasMoreLater: rankedTransferCandidates.length > alternativeTrips.length };
		            return {
		              output: {
		                kind: "trips.search",
		                from: fromResolved.station,
	                to: toResolved.station,
	                via,
	                trips: [],
		                recommendedTripUid,
		                query,
		                page,
		                directOnlyAlternatives: {
		                  maxTransfers: minTransfers,
		                  trips: alternativeTrips,
		                },
	                requestMeta: {
	                  requestedHardKeys,
	                  requestedDirectOnly,
	                },
	                intentMeta: buildIntentMeta({
	                  intent,
	                  appliedHard,
                  appliedSoft,
                  ignoredSoft,
                  beforeCount: normalizedTrips.length,
                  afterCount: 0,
                }),
                cacheTtlSeconds,
                fetchedAt,
                cached: false,
              },
              cacheTtlSeconds,
            };
          }
        }
      }

      return buildConstraintNoMatchError({
        action,
        appliedHard,
        beforeCount: normalizedTrips.length,
        afterCount: 0,
      });
    }

    const rankedTrips = sortTripsBySoftRanks(hardConstraintResult.trips, appliedSoft);
    const trips = rankedTrips.slice(0, limit);

	    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
	    const requestedHardKeys = requestedHardKeysFromIntent(intent);
	    const requestedDirectOnly = requestedDirectOnlyFromIntent(intent);
	    const recommendedTripUid = trips[0]?.uid ?? "";
	    const query = {
	      from: validatedInput.args.from,
	      to: validatedInput.args.to,
	      via: validatedInput.args.via,
	      dateTime: effectiveDateTime,
	      searchForArrival: validatedInput.args.searchForArrival,
	      limit,
	      lang,
	      intent,
	    };
	    const page = { hasMoreLater: rankedTrips.length > trips.length };
	    return {
	      output: {
	        kind: "trips.search",
        from: fromResolved.station,
        to: toResolved.station,
        via,
	        trips,
	        recommendedTripUid,
	        query,
	        page,
	        requestMeta: {
	          requestedHardKeys,
	          requestedDirectOnly,
	        },
	        intentMeta: buildIntentMeta({
	          intent,
	          appliedHard,
          appliedSoft,
          ignoredSoft,
          beforeCount: normalizedTrips.length,
          afterCount: trips.length,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "trips.detail") {
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: [],
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: [],
      });
    }
	    const ignoredSoft = softRanksAll;

	    const lang = normalizeLanguage(validatedInput.args.lang);
	    const response = await nsTripDetail({
	      cfg: nsCfgFromCtx(ctx),
	      ctxRecon: validatedInput.args.ctxRecon,
	      date: normalizeDateTimeInput(validatedInput.args.date),
	      lang,
	    });
	    if (!response.ok) {
	      const error = mapClientErrorToToolError(response.error);
	      return {
	        output: makeErrorOutput({
	          action,
	          code: error.code,
	          message: error.message,
	          details: error.details,
	        }),
	        cacheTtlSeconds: null,
	      };
	    }
	    ctx.ttlHints.push(response.ttlSeconds);

	    const trip = normalizeTripSummary(response.payload, "trip.detail", { includeStops: true });
	    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
	    return {
	      output: {
	        kind: "trips.detail",
        trip,
        intentMeta: buildIntentMeta({
          intent,
          appliedHard: [],
          appliedSoft: [],
          ignoredSoft,
          beforeCount: trip ? 1 : 0,
          afterCount: trip ? 1 : 0,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "journey.detail") {
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: [],
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: [],
      });
    }
	    const ignoredSoft = softRanksAll;

	    const response = await nsJourneyDetail({
	      cfg: nsCfgFromCtx(ctx),
	      id: validatedInput.args.id,
	      train: validatedInput.args.train,
	      dateTime: normalizeDateTimeInput(validatedInput.args.dateTime),
	      departureUicCode: validatedInput.args.departureUicCode,
	      transferUicCode: validatedInput.args.transferUicCode,
	      arrivalUicCode: validatedInput.args.arrivalUicCode,
	      omitCrowdForecast: validatedInput.args.omitCrowdForecast,
	    });
	    if (!response.ok) {
	      const error = mapClientErrorToToolError(response.error);
	      return {
	        output: makeErrorOutput({
	          action,
	          code: error.code,
	          message: error.message,
	          details: error.details,
	        }),
	        cacheTtlSeconds: null,
	      };
	    }
	    ctx.ttlHints.push(response.ttlSeconds);
	    const payload = response.payload;

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
        intentMeta: buildIntentMeta({
          intent,
          appliedHard: [],
          appliedSoft: [],
          ignoredSoft,
          beforeCount: legs.length,
          afterCount: legs.length,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "disruptions.list") {
    const allowedHard: readonly OvNlIntentHardKey[] = ["disruptionTypes", "activeOnly"];
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: allowedHard,
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: allowedHard,
      });
    }
    const { applied: appliedSoft, ignored: ignoredSoft } = partitionSoftRanks({
      all: softRanksAll,
      supported: ["realtime_first"],
    });

    const lang = normalizeLanguage(validatedInput.args.lang);
    const queryType =
      validatedInput.args.type && validatedInput.args.type.length > 0
        ? validatedInput.args.type
        : hard?.disruptionTypes && hard.disruptionTypes.length > 0
          ? hard.disruptionTypes
          : undefined;
	    const queryIsActive =
	      typeof validatedInput.args.isActive === "boolean"
	        ? validatedInput.args.isActive
	        : hard?.activeOnly
	          ? true
	          : undefined;
	    const response = await nsDisruptions({
	      cfg: nsCfgFromCtx(ctx),
	      type: queryType,
	      isActive: queryIsActive,
	      acceptLanguage:
	        lang === "nl" ? "nl-NL, nl;q=0.9, en;q=0.8, *;q=0.5" : "en-US, en;q=0.9, *;q=0.5",
	    });
	    if (!response.ok) {
	      const error = mapClientErrorToToolError(response.error);
	      return {
	        output: makeErrorOutput({
	          action,
	          code: error.code,
	          message: error.message,
	          details: error.details,
	        }),
	        cacheTtlSeconds: null,
	      };
	    }
	    ctx.ttlHints.push(response.ttlSeconds);

	    const baseDisruptions = response.payload.map((item) => normalizeDisruption(item));
	    const appliedHard: string[] = [];
	    let disruptions = baseDisruptions.slice();
    if (Array.isArray(hard?.disruptionTypes) && hard.disruptionTypes.length > 0) {
      const allowedTypes = new Set(hard.disruptionTypes);
      appliedHard.push("disruptionTypes");
      disruptions = disruptions.filter((item) => allowedTypes.has(item.type));
    }
    if (hard?.activeOnly) {
      appliedHard.push("activeOnly");
      disruptions = disruptions.filter((item) => item.isActive);
    }
    if (disruptions.length === 0 && appliedHard.length > 0) {
      return buildConstraintNoMatchError({
        action,
        appliedHard,
        beforeCount: baseDisruptions.length,
        afterCount: 0,
      });
    }
    disruptions = sortDisruptionsBySoftRanks(disruptions, appliedSoft);

    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "disruptions.list",
        disruptions,
        intentMeta: buildIntentMeta({
          intent,
          appliedHard,
          appliedSoft,
          ignoredSoft,
          beforeCount: baseDisruptions.length,
          afterCount: disruptions.length,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  if (action === "disruptions.by_station") {
    const allowedHard: readonly OvNlIntentHardKey[] = ["disruptionTypes", "activeOnly"];
    const unsupportedHard = resolveUnsupportedHardKeys({
      hard,
      allowed: allowedHard,
    });
    if (unsupportedHard.length > 0) {
      return buildUnsupportedHardError({
        action,
        unsupported: unsupportedHard,
        allowed: allowedHard,
      });
    }
    const { applied: appliedSoft, ignored: ignoredSoft } = partitionSoftRanks({
      all: softRanksAll,
      supported: ["realtime_first"],
    });

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
	    const response = await nsDisruptionsByStation({
	      cfg: nsCfgFromCtx(ctx),
	      stationCode: station.code,
	    });
	    if (!response.ok) {
	      const error = mapClientErrorToToolError(response.error);
	      return {
	        output: makeErrorOutput({
	          action,
	          code: error.code,
	          message: error.message,
	          details: error.details,
	        }),
	        cacheTtlSeconds: null,
	      };
	    }
	    ctx.ttlHints.push(response.ttlSeconds);

	    const baseDisruptions = response.payload.map((item) => normalizeDisruption(item));
	    const appliedHard: string[] = [];
	    let disruptions = baseDisruptions.slice();
    if (Array.isArray(hard?.disruptionTypes) && hard.disruptionTypes.length > 0) {
      const allowedTypes = new Set(hard.disruptionTypes);
      appliedHard.push("disruptionTypes");
      disruptions = disruptions.filter((item) => allowedTypes.has(item.type));
    }
    if (hard?.activeOnly) {
      appliedHard.push("activeOnly");
      disruptions = disruptions.filter((item) => item.isActive);
    }
    if (disruptions.length === 0 && appliedHard.length > 0) {
      return buildConstraintNoMatchError({
        action,
        appliedHard,
        beforeCount: baseDisruptions.length,
        afterCount: 0,
      });
    }
    disruptions = sortDisruptionsBySoftRanks(disruptions, appliedSoft);

    const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
    return {
      output: {
        kind: "disruptions.by_station",
        station,
        disruptions,
        intentMeta: buildIntentMeta({
          intent,
          appliedHard,
          appliedSoft,
          ignoredSoft,
          beforeCount: baseDisruptions.length,
          afterCount: disruptions.length,
        }),
        cacheTtlSeconds,
        fetchedAt,
        cached: false,
      },
      cacheTtlSeconds,
    };
  }

  const unsupportedHard = resolveUnsupportedHardKeys({
    hard,
    allowed: [],
  });
  if (unsupportedHard.length > 0) {
    return buildUnsupportedHardError({
      action,
      unsupported: unsupportedHard,
      allowed: [],
    });
  }
	const ignoredSoft = softRanksAll;

	const response = await nsDisruptionDetail({
	  cfg: nsCfgFromCtx(ctx),
	  type: validatedInput.args.type,
	  id: validatedInput.args.id,
	});
	if (!response.ok) {
	  const error = mapClientErrorToToolError(response.error);
	  return {
	    output: makeErrorOutput({
	      action,
	      code: error.code,
	      message: error.message,
	      details: error.details,
	    }),
	    cacheTtlSeconds: null,
	  };
	}
	ctx.ttlHints.push(response.ttlSeconds);

	const disruption = normalizeDisruption(response.payload);
	const cacheTtlSeconds = pickActionTtlSeconds(ctx.cfg.cacheMaxTtlSeconds, ctx.ttlHints);
	return {
	  output: {
	    kind: "disruptions.detail",
      disruption,
      intentMeta: buildIntentMeta({
        intent,
        appliedHard: [],
        appliedSoft: [],
        ignoredSoft,
        beforeCount: disruption ? 1 : 0,
        afterCount: disruption ? 1 : 0,
      }),
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
      "Gateway for Dutch rail (NS) live travel information via NS Reisinformatie. Use this for stations, departure/arrival boards, trips between stations, journey details, and disruptions. Do NOT use this for walking/driving directions, general travel planning (flights/hotels/itineraries), or vague location phrases like 'my house'. If the user intent is unclear or required route/station details are missing, ask one concise clarification question instead of calling ovNlGateway.",
    inputSchema: OvNlGatewayToolWireInputSchema,
    execute: async (toolInput): Promise<OvNlToolOutput> => {
      const action = asText((toolInput as { action?: unknown }).action) as OvNlToolAction;
      const rawArgs = (toolInput as { args?: unknown }).args;
      const looseArgs =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
      const sanitizedArgsRaw = sanitizeLooseToolArgs(looseArgs);
      const fixed = autoFixActionAndArgs({
        action,
        args:
          sanitizedArgsRaw && typeof sanitizedArgsRaw === "object" && !Array.isArray(sanitizedArgsRaw)
            ? (sanitizedArgsRaw as Record<string, unknown>)
            : {},
      });
      const args = coerceToolArgsForValidation(fixed.action, fixed.args);
      const parsed = OvNlGatewayToolValidatedInputSchema.safeParse({
        action: fixed.action,
        args,
      });

      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        const issuePath =
          firstIssue && Array.isArray(firstIssue.path) && firstIssue.path.length > 0
            ? firstIssue.path.join(".")
            : "args";
        const issueMessage =
          firstIssue && typeof firstIssue.message === "string"
            ? firstIssue.message.trim()
            : "validation failed";
        return makeErrorOutput({
          action: action || "stations.search",
          code: "invalid_tool_input",
          message: `Invalid ovNlGateway tool input (${issuePath}: ${issueMessage}).`,
          details: { issues: parsed.error.issues },
        });
      }

      const { sanitized, droppedHardConstraints } = sanitizeInputIntentForAction(parsed.data);
      const cacheKey = makeCacheKey(sanitized.action, sanitized.args);
      const cachedOutput = getCachedOutput(cacheKey);
      if (cachedOutput) {
        const cachedIntentMeta =
          "intentMeta" in cachedOutput &&
          cachedOutput.intentMeta &&
          typeof cachedOutput.intentMeta === "object"
            ? cachedOutput.intentMeta
            : undefined;
        logEvent("info", "ov_nl.gateway_result", {
          action: sanitized.action,
          kind: cachedOutput.kind,
          cached: true,
          cacheTtlSeconds: "cacheTtlSeconds" in cachedOutput ? cachedOutput.cacheTtlSeconds : null,
          intent_present: Boolean(cachedIntentMeta),
          hard_count: cachedIntentMeta?.appliedHard?.length ?? 0,
          soft_count: cachedIntentMeta?.appliedSoft?.length ?? 0,
          before_count:
            typeof cachedIntentMeta?.beforeCount === "number"
              ? cachedIntentMeta.beforeCount
              : null,
          after_count:
            typeof cachedIntentMeta?.afterCount === "number" ? cachedIntentMeta.afterCount : null,
          ignored_hard_constraints: droppedHardConstraints,
          ignored_hard_count: droppedHardConstraints.length,
          no_match: false,
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

      const result = await executeAction(ctx, sanitized);
      if (result.output.kind !== "error" && result.cacheTtlSeconds != null) {
        setCachedOutput(cacheKey, result.output, result.cacheTtlSeconds);
      }
      const intentMeta =
        "intentMeta" in result.output &&
        result.output.intentMeta &&
        typeof result.output.intentMeta === "object"
          ? result.output.intentMeta
          : undefined;
      const noMatch =
        result.output.kind === "error" && result.output.error.code === "constraint_no_match";
      logEvent("info", "ov_nl.gateway_result", {
        action: sanitized.action,
        kind: result.output.kind,
        cached: result.output.cached,
        cacheTtlSeconds: "cacheTtlSeconds" in result.output ? result.output.cacheTtlSeconds : null,
        error_code: result.output.kind === "error" ? result.output.error.code : null,
        intent_present: Boolean(intentMeta),
        hard_count: intentMeta?.appliedHard?.length ?? 0,
        soft_count: intentMeta?.appliedSoft?.length ?? 0,
        before_count: typeof intentMeta?.beforeCount === "number" ? intentMeta.beforeCount : null,
        after_count: typeof intentMeta?.afterCount === "number" ? intentMeta.afterCount : null,
        ignored_hard_constraints: droppedHardConstraints,
        ignored_hard_count: droppedHardConstraints.length,
        no_match: noMatch,
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
