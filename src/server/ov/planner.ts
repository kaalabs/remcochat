import type { OvNlIntent } from "@/lib/types";
import type { OvNlToolAction } from "@/lib/types";
import { OvQueryV1Schema, type OvQueryV1 } from "@/server/ov/query-schema";

export type OvPlanV1 = {
  version: 1;
  action: OvNlToolAction;
  args: Record<string, unknown>;
  requestMeta: {
    requestedHardKeys: string[];
    requestedDirectOnly: boolean;
  };
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requestedDirectOnlyFromHard(hard: Record<string, unknown> | undefined): boolean {
  if (!hard) return false;
  if (hard.directOnly === true) return true;
  const maxTransfers = hard.maxTransfers;
  return typeof maxTransfers === "number" && Number.isFinite(maxTransfers) && maxTransfers <= 0;
}

function buildIntent(requested: OvQueryV1["requested"]): OvNlIntent | undefined {
  const hard = requested.hard && typeof requested.hard === "object" ? requested.hard : undefined;
  const soft = requested.soft && typeof requested.soft === "object" ? requested.soft : undefined;
  if (!hard && !soft) return undefined;
  const intent: OvNlIntent = {};
  if (hard) intent.hard = hard as OvNlIntent["hard"];
  if (soft) intent.soft = soft as OvNlIntent["soft"];
  return intent;
}

function allowlistArgs(action: OvNlToolAction, args: Record<string, unknown>): Record<string, unknown> {
  const allowedByAction: Record<OvNlToolAction, readonly string[]> = {
    "stations.search": ["query", "limit", "countryCodes", "lang"],
    "stations.nearest": ["latitude", "longitude", "lat", "lng", "limit", "lang"],
    "departures.list": ["station", "stationCode", "uicCode", "dateTime", "maxJourneys", "lang", "intent"],
    "departures.window": ["station", "stationCode", "uicCode", "date", "fromTime", "toTime", "fromDateTime", "toDateTime", "maxJourneys", "lang", "intent"],
    "arrivals.list": ["station", "stationCode", "uicCode", "dateTime", "maxJourneys", "lang", "intent"],
    "trips.search": ["from", "to", "via", "dateTime", "searchForArrival", "maxJourneys", "lang", "intent"],
    "trips.detail": ["ctxRecon", "lang", "intent"],
    "journey.detail": ["id", "train", "lang", "intent"],
    "disruptions.list": ["type", "isActive", "lang", "intent"],
    "disruptions.by_station": ["station", "stationCode", "uicCode", "type", "isActive", "lang", "intent"],
    "disruptions.detail": ["type", "id", "lang", "intent"],
  };

  const allowed = new Set(allowedByAction[action] ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!allowed.has(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    out[key] = value;
  }
  return out;
}

export function compileOvPlan(queryInput: unknown): { ok: true; plan: OvPlanV1 } | { ok: false; missing: string[]; clarification: string } {
  const parsed = OvQueryV1Schema.safeParse(queryInput);
  if (!parsed.success) {
    return {
      ok: false,
      missing: ["ov_query"],
      clarification: "Could you rephrase your OV request (station/route)?",
    };
  }
  const query = parsed.data;
  const requestedHard = query.requested.hard && typeof query.requested.hard === "object" ? query.requested.hard : undefined;
  const requestedHardKeys = requestedHard ? Object.keys(requestedHard) : [];
  const requestedDirectOnly = requestedDirectOnlyFromHard(requestedHard);

  const intent = buildIntent(query.requested);

  const baseArgs: Record<string, unknown> = {};
  if (intent) baseArgs.intent = intent;

  switch (query.intentKind) {
    case "stations.search": {
      const queryText = asText(query.slots.stationText);
      const args = allowlistArgs("stations.search", { ...baseArgs, query: queryText });
      if (!hasText(args.query)) {
        return { ok: false, missing: ["query"], clarification: "Which station should I search for?" };
      }
      return {
        ok: true,
        plan: { version: 1, action: "stations.search", args, requestMeta: { requestedHardKeys, requestedDirectOnly } },
      };
    }
    case "departures.list":
    case "arrivals.list": {
      const station = asText(query.slots.stationText);
      const action = query.intentKind as OvNlToolAction;
      const args = allowlistArgs(action, { ...baseArgs, station });
      if (!hasText(args.station)) {
        return { ok: false, missing: ["station"], clarification: "Which station should I use?" };
      }
      return {
        ok: true,
        plan: { version: 1, action, args, requestMeta: { requestedHardKeys, requestedDirectOnly } },
      };
    }
    case "departures.window": {
      const station = asText(query.slots.stationText);
      const fromTime = asText(query.slots.fromTime);
      const toTime = asText(query.slots.toTime);
      const date = asText(query.slots.date);
      const args = allowlistArgs("departures.window", { ...baseArgs, station, date: date || undefined, fromTime, toTime });
      const hasStation = hasText(args.station) || hasText(args.stationCode) || hasText(args.uicCode);
      const hasWindow = hasText(args.fromTime) && hasText(args.toTime);
      if (!hasStation) return { ok: false, missing: ["station"], clarification: "Which station should I use?" };
      if (!hasWindow) return { ok: false, missing: ["from/to window"], clarification: "What time window should I use (for example 18:00 to 19:00)?" };
      return {
        ok: true,
        plan: { version: 1, action: "departures.window", args, requestMeta: { requestedHardKeys, requestedDirectOnly } },
      };
    }
    case "trips.search": {
      const from = asText(query.slots.fromText);
      const to = asText(query.slots.toText);
      const via = asText(query.slots.viaText);
      const dateTime = asText(query.slots.dateTimeHint);
      const args = allowlistArgs("trips.search", {
        ...baseArgs,
        from,
        to,
        ...(via ? { via } : {}),
        ...(dateTime ? { dateTime } : {}),
      });
      if (!hasText(args.from) || !hasText(args.to)) {
        return { ok: false, missing: ["from", "to"], clarification: "From which station to which station should I search?" };
      }
      return {
        ok: true,
        plan: { version: 1, action: "trips.search", args, requestMeta: { requestedHardKeys, requestedDirectOnly } },
      };
    }
    case "trips.detail": {
      const ctxRecon = asText(query.slots.ctxRecon);
      const args = allowlistArgs("trips.detail", { ...baseArgs, ctxRecon });
      if (!hasText(args.ctxRecon)) {
        return { ok: false, missing: ["ctxRecon"], clarification: "Which trip option should I load details for?" };
      }
      return {
        ok: true,
        plan: { version: 1, action: "trips.detail", args, requestMeta: { requestedHardKeys, requestedDirectOnly } },
      };
    }
    default: {
      return {
        ok: false,
        missing: ["intentKind"],
        clarification: "Could you rephrase your OV request (route or station)?",
      };
    }
  }
}
