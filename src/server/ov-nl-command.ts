import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getLanguageModelForProvider } from "@/server/llm-provider";
import { extractJsonObject } from "@/server/llm-json";
import type { OvNlIntent, OvNlToolAction, OvNlToolOutput } from "@/lib/types";
import {
  applyTripsTextHeuristicsToArgs,
  extractRouteFromText,
} from "@/lib/ov-nl-route-heuristics";

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

const OvNlIntentSchema = z
  .object({
    hard: z
      .object({
        directOnly: z.boolean().optional(),
        maxTransfers: z.number().int().optional(),
        maxDurationMinutes: z.number().int().optional(),
        departureAfter: z.string().optional(),
        departureBefore: z.string().optional(),
        arrivalAfter: z.string().optional(),
        arrivalBefore: z.string().optional(),
        includeModes: z.array(OvNlIntentModeSchema).optional(),
        excludeModes: z.array(OvNlIntentModeSchema).optional(),
        includeOperators: z.array(z.string()).optional(),
        excludeOperators: z.array(z.string()).optional(),
        includeTrainCategories: z.array(z.string()).optional(),
        excludeTrainCategories: z.array(z.string()).optional(),
        avoidStations: z.array(z.string()).optional(),
        excludeCancelled: z.boolean().optional(),
        requireRealtime: z.boolean().optional(),
        platformEquals: z.string().optional(),
        disruptionTypes: z
          .array(z.enum(["CALAMITY", "DISRUPTION", "MAINTENANCE"]))
          .optional(),
        activeOnly: z.boolean().optional(),
      })
      .strict()
      .optional(),
    soft: z
      .object({
        rankBy: z.array(OvNlIntentRankSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const OvNlCommandArgsSchema = z
  .object({
    query: z.string().optional(),
    limit: z.number().int().optional(),
    countryCodes: z.array(z.string()).optional(),

    latitude: z.number().optional(),
    longitude: z.number().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),

    station: z.string().optional(),
    stationCode: z.string().optional(),
    uicCode: z.string().optional(),
    dateTime: z.string().optional(),
    fromDateTime: z.string().optional(),
    toDateTime: z.string().optional(),
    fromTime: z.string().optional(),
    toTime: z.string().optional(),
    maxJourneys: z.number().int().optional(),
    lang: z.string().optional(),

    from: z.string().optional(),
    to: z.string().optional(),
    via: z.string().optional(),
    searchForArrival: z.boolean().optional(),
    date: z.string().optional(),
    ctxRecon: z.string().optional(),

    id: z.string().optional(),
    train: z.number().int().optional(),
    departureUicCode: z.string().optional(),
    transferUicCode: z.string().optional(),
    arrivalUicCode: z.string().optional(),
    omitCrowdForecast: z.boolean().optional(),

    type: z
      .union([
        z.enum(["CALAMITY", "DISRUPTION", "MAINTENANCE"]),
        z.array(z.enum(["CALAMITY", "DISRUPTION", "MAINTENANCE"])),
      ])
      .optional(),
    isActive: z.boolean().optional(),

    intent: OvNlIntentSchema.optional(),
  })
  .strict();

const OvNlCommandSchema = z
  .object({
    action: z.enum(OV_NL_ACTIONS),
    args: OvNlCommandArgsSchema.default({}),
    confidence: z.number().min(0).max(1),
    missing: z.array(z.string()).default([]),
    clarification: z.string().optional().default(""),
    isFollowUp: z.boolean().default(false),
  })
  .strict();

export type OvNlCommand = {
  action: OvNlToolAction;
  args: Record<string, unknown>;
  intent?: OvNlIntent;
  confidence: number;
  missing: string[];
  clarification: string;
  isFollowUp: boolean;
};

export type OvNlCommandRouteResult =
  | {
      ok: true;
      command: OvNlCommand;
    }
  | {
      ok: false;
      reason: "disabled" | "parse_failed" | "low_confidence" | "missing_required";
      confidence: number;
      clarification: string;
      missing: string[];
      command?: OvNlCommand;
    };

const ROUTER_PROMPT = [
  "You are RemcoChat's OV NL intent compiler.",
  "Extract exactly one ovNlGateway command from the latest user message.",
  "Return JSON only and match the schema exactly.",
  "Prefer preserving existing route context when the user sends a follow-up refinement.",
  "Follow-up refinements include phrases like: make it direct, fewer transfers, earlier, later, quicker, only NS, zonder overstap, liever direct, eerder, later.",
  "When the user asks for direct options (for example 'directe treinopties'), treat that as strict and map to intent.hard directOnly/maxTransfers=0 unless they explicitly express a preference (for example liefst/bij voorkeur).",
  "If the user uses hard language (only/must/no/without/geen/alleen/zonder/niet), map to intent.hard.",
  "If the user uses preference language (prefer/liefst/best/bij voorkeur), map to intent.soft.rankBy.",
  "Use intent.soft.rankBy=fewest_transfers when the user prefers direct options.",
  "If required fields are missing and cannot be recovered from context, set missing[] and add one short clarification question.",
  "Do not invent station names, ids, ctxRecon, or train ids.",
  "Supported rankBy values: fastest, fewest_transfers, earliest_departure, earliest_arrival, realtime_first, least_walking.",
].join("\n");

function deterministicCommandFromText(text: string): OvNlCommand | null {
  const route = extractRouteFromText(text);
  if (!route) return null;

  const args = applyTripsTextHeuristicsToArgs({
    text,
    args: {
      from: route.from,
      to: route.to,
    },
  });

  const intent =
    args.intent && typeof args.intent === "object" ? (args.intent as OvNlIntent) : undefined;

  return {
    action: "trips.search",
    args,
    intent,
    confidence: 0.95,
    missing: [],
    clarification: "",
    isFollowUp: false,
  };
}

function formatOutputForPrompt(output: OvNlToolOutput | null | undefined): string {
  if (!output) return "none";
  try {
    const text = JSON.stringify(output, null, 2);
    return text.length <= 4000 ? text : `${text.slice(0, 4000)}\n...[truncated]`;
  } catch {
    return "unserializable";
  }
}

function cleanObject(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => cleanObject(item))
      .filter((item) => item !== undefined);
    return cleaned;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = cleanObject(inner);
      if (cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return out;
  }
  return value;
}

function stationNameFromOutput(output: OvNlToolOutput | null | undefined): string {
  if (!output) return "";
  if (
    output.kind === "departures.list" ||
    output.kind === "departures.window" ||
    output.kind === "arrivals.list" ||
    output.kind === "disruptions.by_station"
  ) {
    return (
      output.station?.nameLong ||
      output.station?.nameMedium ||
      output.station?.nameShort ||
      output.station?.code ||
      ""
    );
  }
  return "";
}

function mergeFollowUpWithContext(input: {
  command: OvNlCommand;
  context?: { lastOvOutput?: OvNlToolOutput | null; previousUserText?: string };
}): OvNlCommand {
  const command = {
    ...input.command,
    args: { ...(input.command.args ?? {}) },
  };
  const output = input.context?.lastOvOutput;
  if (!command.isFollowUp || !output) return command;

  if (command.action === "trips.search" && output.kind === "trips.search") {
    if (!command.args.from && output.from) {
      command.args.from =
        output.from.nameLong || output.from.nameMedium || output.from.nameShort || output.from.code;
    }
    if (!command.args.to && output.to) {
      command.args.to = output.to.nameLong || output.to.nameMedium || output.to.nameShort || output.to.code;
    }
    if (command.args.via === undefined && output.via) {
      command.args.via = output.via.nameLong || output.via.nameMedium || output.via.nameShort || output.via.code;
    }
  }

  if (
    (command.action === "departures.list" ||
      command.action === "departures.window" ||
      command.action === "arrivals.list") &&
    !command.args.station &&
    !command.args.stationCode &&
    !command.args.uicCode
  ) {
    const station = stationNameFromOutput(output);
    if (station) command.args.station = station;
  }

  if (command.action === "disruptions.by_station" && !command.args.station) {
    const station = stationNameFromOutput(output);
    if (station) command.args.station = station;
  }

  return command;
}

function requiredMissingForAction(command: OvNlCommand): string[] {
  const args = command.args;
  if (command.action === "stations.search") {
    return typeof args.query === "string" && args.query.trim() ? [] : ["query"];
  }
  if (command.action === "stations.nearest") {
    const hasLat = Number.isFinite(Number(args.latitude ?? args.lat));
    const hasLng = Number.isFinite(Number(args.longitude ?? args.lng));
    return hasLat && hasLng ? [] : ["latitude", "longitude"];
  }
  if (command.action === "departures.list" || command.action === "arrivals.list") {
    const hasStation =
      (typeof args.station === "string" && args.station.trim()) ||
      (typeof args.stationCode === "string" && args.stationCode.trim()) ||
      (typeof args.uicCode === "string" && args.uicCode.trim());
    return hasStation ? [] : ["station"];
  }
  if (command.action === "departures.window") {
    const missing: string[] = [];
    const hasStation =
      (typeof args.station === "string" && args.station.trim()) ||
      (typeof args.stationCode === "string" && args.stationCode.trim()) ||
      (typeof args.uicCode === "string" && args.uicCode.trim());
    if (!hasStation) missing.push("station");
    const hasDateTimes =
      typeof args.fromDateTime === "string" &&
      args.fromDateTime.trim() &&
      typeof args.toDateTime === "string" &&
      args.toDateTime.trim();
    const hasTimes =
      typeof args.fromTime === "string" &&
      args.fromTime.trim() &&
      typeof args.toTime === "string" &&
      args.toTime.trim();
    if (!hasDateTimes && !hasTimes) missing.push("from/to window");
    return missing;
  }
  if (command.action === "trips.search") {
    const missing: string[] = [];
    if (!(typeof args.from === "string" && args.from.trim())) missing.push("from");
    if (!(typeof args.to === "string" && args.to.trim())) missing.push("to");
    return missing;
  }
  if (command.action === "trips.detail") {
    return typeof args.ctxRecon === "string" && args.ctxRecon.trim() ? [] : ["ctxRecon"];
  }
  if (command.action === "journey.detail") {
    const hasId = typeof args.id === "string" && args.id.trim();
    const hasTrain = Number.isFinite(Number(args.train));
    return hasId || hasTrain ? [] : ["id or train"];
  }
  if (command.action === "disruptions.by_station") {
    return typeof args.station === "string" && args.station.trim() ? [] : ["station"];
  }
  if (command.action === "disruptions.detail") {
    const missing: string[] = [];
    if (!(typeof args.type === "string" && args.type.trim())) missing.push("type");
    if (!(typeof args.id === "string" && args.id.trim())) missing.push("id");
    return missing;
  }
  return [];
}

function clarificationForMissing(command: OvNlCommand, missing: string[]): string {
  if (command.clarification.trim()) return command.clarification.trim();
  if (command.action === "trips.search") {
    if (missing.includes("from") && missing.includes("to")) {
      return "From which station to which station should I search?";
    }
    if (missing.includes("from")) return "Which departure station should I use?";
    if (missing.includes("to")) return "Which destination station should I use?";
  }
  if (command.action === "departures.window" && missing.includes("from/to window")) {
    return "What time window should I use (for example 18:00 to 19:00)?";
  }
  if (missing.includes("station")) {
    return "Which station should I use?";
  }
  return "Could you provide the missing details so I can continue?";
}

async function extractWithPrompt(input: {
  model: LanguageModel;
  prompt: string;
  temperature?: number;
}) {
  const { text } = await generateText({
    model: input.model,
    prompt: `${input.prompt}\n\nReturn ONLY valid JSON and no other text.`,
    ...(Number.isFinite(input.temperature ?? NaN)
      ? { temperature: input.temperature as number }
      : {}),
  });
  return OvNlCommandSchema.parse(extractJsonObject(text));
}

export async function routeOvNlCommand(input: {
  text: string;
  context?: {
    previousUserText?: string;
    lastOvOutput?: OvNlToolOutput | null;
  };
}): Promise<OvNlCommandRouteResult> {
  const text = String(input.text ?? "").trim();
  if (!text) {
    return {
      ok: false,
      reason: "parse_failed",
      confidence: 0,
      clarification: "",
      missing: ["user_text"],
    };
  }

  const deterministic = deterministicCommandFromText(text);
  const router = getConfig().intentRouter;
  if (!router || !router.enabled) {
    if (deterministic) {
      const missing = requiredMissingForAction(deterministic);
      if (missing.length > 0) {
        return {
          ok: false,
          reason: "missing_required",
          confidence: deterministic.confidence,
          clarification: clarificationForMissing(deterministic, missing),
          missing,
          command: { ...deterministic, missing },
        };
      }
      return { ok: true, command: deterministic };
    }
    return {
      ok: false,
      reason: "disabled",
      confidence: 0,
      clarification: "",
      missing: [],
    };
  }

  const clipped = text.slice(0, router.maxInputChars);
  let resolved: Awaited<ReturnType<typeof getLanguageModelForProvider>>;
  try {
    resolved = await getLanguageModelForProvider(router.providerId, router.modelId);
  } catch {
    if (deterministic) return { ok: true, command: deterministic };
    return {
      ok: false,
      reason: "parse_failed",
      confidence: 0,
      clarification: "",
      missing: [],
    };
  }

  const previousUserText = String(input.context?.previousUserText ?? "").trim();
  const lastOvSummary = formatOutputForPrompt(input.context?.lastOvOutput);

  let raw: z.infer<typeof OvNlCommandSchema>;
  try {
    raw = await extractWithPrompt({
      model: resolved.model,
      prompt:
        `${ROUTER_PROMPT}\n\n` +
        `Previous user message:\n"""${previousUserText.slice(0, 1000)}"""\n\n` +
        `Last OV output summary:\n${lastOvSummary}\n\n` +
        `Latest user message:\n"""${clipped}"""`,
      temperature:
        resolved.capabilities.temperature && !resolved.capabilities.reasoning
          ? 0
          : undefined,
    });
  } catch {
    try {
      raw = await extractWithPrompt({
        model: resolved.model,
        prompt:
          `${ROUTER_PROMPT}\n\n` +
          `Previous user message:\n"""${previousUserText.slice(0, 1000)}"""\n\n` +
          `Last OV output summary:\n${lastOvSummary}\n\n` +
          `Latest user message:\n"""${clipped}"""\n\n` +
          "IMPORTANT: Output JSON only. No markdown. No prose.",
        temperature:
          resolved.capabilities.temperature && !resolved.capabilities.reasoning
            ? 0
            : undefined,
      });
    } catch {
      if (deterministic) return { ok: true, command: deterministic };
      return {
        ok: false,
        reason: "parse_failed",
        confidence: 0,
        clarification: "",
        missing: [],
      };
    }
  }

  const argsCleaned = cleanObject(raw.args);
  const command: OvNlCommand = {
    action: raw.action,
    args: (argsCleaned && typeof argsCleaned === "object"
      ? (argsCleaned as Record<string, unknown>)
      : {}) as Record<string, unknown>,
    intent:
      raw.args.intent && typeof raw.args.intent === "object"
        ? (raw.args.intent as OvNlIntent)
        : undefined,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0))),
    missing: Array.isArray(raw.missing) ? raw.missing.map((v) => String(v).trim()).filter(Boolean) : [],
    clarification: String(raw.clarification ?? "").trim(),
    isFollowUp: Boolean(raw.isFollowUp),
  };

  const merged = mergeFollowUpWithContext({
    command,
    context: {
      previousUserText,
      lastOvOutput: input.context?.lastOvOutput ?? null,
    },
  });
  if (merged.action === "trips.search") {
    merged.args = applyTripsTextHeuristicsToArgs({
      text,
      args: merged.args,
    });
    merged.intent =
      merged.args.intent && typeof merged.args.intent === "object"
        ? (merged.args.intent as OvNlIntent)
        : undefined;
  }
  merged.missing = requiredMissingForAction(merged);

  if (merged.confidence < router.minConfidence) {
    if (deterministic) return { ok: true, command: deterministic };
    return {
      ok: false,
      reason: "low_confidence",
      confidence: merged.confidence,
      clarification: merged.clarification,
      missing: merged.missing,
      command: merged,
    };
  }

  if (merged.missing.length > 0) {
    if (deterministic) return { ok: true, command: deterministic };
    return {
      ok: false,
      reason: "missing_required",
      confidence: merged.confidence,
      clarification: clarificationForMissing(merged, merged.missing),
      missing: merged.missing,
      command: merged,
    };
  }

  return {
    ok: true,
    command: merged,
  };
}

export const __test__ = {
  requiredMissingForAction,
  clarificationForMissing,
  mergeFollowUpWithContext,
};
