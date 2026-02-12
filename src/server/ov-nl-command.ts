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
  "Return exactly one JSON object with these top-level keys: action, args, confidence, missing, clarification, isFollowUp.",
  `action must be one of: ${OV_NL_ACTIONS.join(", ")}.`,
  "args must be an object with only fields relevant to the selected action.",
  "Prefer preserving existing route context when the user sends a follow-up refinement.",
  "For a departure board request without an explicit time window, use action='departures.list' with args { station }.",
  "For a departure board request with an explicit time window (for example 'tussen 18:00 en 19:00' or 'van 18:00 tot 19:00'), use action='departures.window' with args { station, fromTime, toTime, date? }.",
  "If a board request is missing the station, set missing=['station'] and ask one concise clarification question.",
  "Follow-up refinements include phrases like: make it direct, fewer transfers, earlier, later, quicker, only NS, zonder overstap, liever direct, eerder, later.",
  "When the user asks for direct options (for example 'directe treinopties'), treat that as strict and map to intent.hard directOnly/maxTransfers=0 unless they explicitly express a preference (for example liefst/bij voorkeur).",
  "If the user uses hard language (only/must/no/without/geen/alleen/zonder/niet), map to intent.hard.",
  "If the user uses preference language (prefer/liefst/best/bij voorkeur), map to intent.soft.rankBy.",
  "Use intent.soft.rankBy=fewest_transfers when the user prefers direct options.",
  "If required fields are missing and cannot be recovered from context, set missing[] and add one short clarification question.",
  "Do not invent station names, ids, ctxRecon, or train ids.",
  "Supported rankBy values: fastest, fewest_transfers, earliest_departure, earliest_arrival, realtime_first, least_walking.",
  "Example board request output: {\"action\":\"departures.list\",\"args\":{\"station\":\"Almere Muziekwijk\"},\"confidence\":0.95,\"missing\":[],\"clarification\":\"\",\"isFollowUp\":false}",
  "Example board window output: {\"action\":\"departures.window\",\"args\":{\"station\":\"Almere Muziekwijk\",\"fromTime\":\"18:00\",\"toTime\":\"19:00\"},\"confidence\":0.95,\"missing\":[],\"clarification\":\"\",\"isFollowUp\":false}",
].join("\n");

const BOARD_INTENT_RE =
  /\b(vertrekbord|vertrekken|vertrektijden?|departures?|aankomstbord|aankomsten?|arrivals?)\b/i;
const DEPARTURE_BOARD_RE = /\b(vertrekbord|vertrekken|vertrektijden?|departures?)\b/i;
const ARRIVAL_BOARD_RE = /\b(aankomstbord|aankomsten?|arrivals?)\b/i;
const BOARD_WINDOW_PATTERNS = [
  /\btussen\s+(\d{1,2}(?::|\.)\d{2})\s+en\s+(\d{1,2}(?::|\.)\d{2})\b/i,
  /\bvan\s+(\d{1,2}(?::|\.)\d{2})\s+tot\s+(\d{1,2}(?::|\.)\d{2})\b/i,
  /\bfrom\s+(\d{1,2}(?::|\.)\d{2})\s+to\s+(\d{1,2}(?::|\.)\d{2})\b/i,
] as const;
const BOARD_STATION_PATTERNS = [
  /\bvan\s+station\s+(.+?)(?=$|[.?!,;]|\s+\b(?:tussen|om|met|zonder|voor|for|from|to|between|arrivals?|departures?|vertrek(?:ken|bord|tijden?)?|aankomst(?:en|bord)?|show|toon|geef|laat|zien|please)\b)/i,
  /\bop\s+station\s+(.+?)(?=$|[.?!,;]|\s+\b(?:tussen|om|met|zonder|voor|for|from|to|between|arrivals?|departures?|vertrek(?:ken|bord|tijden?)?|aankomst(?:en|bord)?|show|toon|geef|laat|zien|please)\b)/i,
  /\bstation\s+(.+?)(?=$|[.?!,;]|\s+\b(?:tussen|om|met|zonder|voor|for|from|to|between|arrivals?|departures?|vertrek(?:ken|bord|tijden?)?|aankomst(?:en|bord)?|show|toon|geef|laat|zien|please)\b)/i,
] as const;
const BOARD_STATION_TRAILING_RE =
  /\b(?:show|toon|geef|laat(?:\s+het)?|zien|please|alstublieft)\b.*$/i;

function normalizeClockTime(value: string): string | null {
  const normalized = String(value ?? "").trim().replace(".", ":");
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractBoardWindow(text: string): { fromTime: string; toTime: string } | null {
  for (const pattern of BOARD_WINDOW_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const fromTime = normalizeClockTime(match[1] ?? "");
    const toTime = normalizeClockTime(match[2] ?? "");
    if (!fromTime || !toTime) continue;
    return { fromTime, toTime };
  }
  return null;
}

function cleanBoardStationCandidate(value: string): string {
  let out = String(value ?? "").trim();
  if (!out) return "";
  out = out.replace(/^[("'`]+/, "").replace(/[)"'`]+$/, "").trim();
  out = out.replace(BOARD_STATION_TRAILING_RE, "").trim();
  out = out.replace(/[.,;:!?]+$/, "").trim();
  out = out.replace(/\s+/g, " ").trim();
  if (!out || out.length > 120) return "";
  return out;
}

function extractBoardStation(text: string): string {
  for (const pattern of BOARD_STATION_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const cleaned = cleanBoardStationCandidate(match[1] ?? "");
    if (cleaned) return cleaned;
  }
  return "";
}

function deterministicBoardCommandFromText(text: string): OvNlCommand | null {
  if (!BOARD_INTENT_RE.test(text)) return null;

  const station = extractBoardStation(text);
  const window = extractBoardWindow(text);
  const wantsArrivals = ARRIVAL_BOARD_RE.test(text) && !DEPARTURE_BOARD_RE.test(text);
  const action: OvNlToolAction = window
    ? "departures.window"
    : wantsArrivals
      ? "arrivals.list"
      : "departures.list";
  const args: Record<string, unknown> = {};

  if (station) args.station = station;
  if (window) {
    args.fromTime = window.fromTime;
    args.toTime = window.toTime;
  }

  return {
    action,
    args,
    confidence: 0.95,
    missing: [],
    clarification: "",
    isFollowUp: false,
  };
}

function deterministicCommandFromText(text: string): OvNlCommand | null {
  const boardCommand = deterministicBoardCommandFromText(text);
  if (boardCommand) return boardCommand;

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
  const deterministicMissing = deterministic ? requiredMissingForAction(deterministic) : [];
  const deterministicWithMissing = deterministic
    ? ({
        ...deterministic,
        missing: deterministicMissing,
      } as OvNlCommand)
    : null;
  const deterministicSuccessResult: OvNlCommandRouteResult | null =
    deterministicWithMissing && deterministicMissing.length === 0
      ? {
          ok: true,
          command: deterministicWithMissing,
        }
      : null;
  const deterministicMissingResult: OvNlCommandRouteResult | null =
    deterministicWithMissing && deterministicMissing.length > 0
      ? {
          ok: false,
          reason: "missing_required",
          confidence: deterministicWithMissing.confidence,
          clarification: clarificationForMissing(deterministicWithMissing, deterministicMissing),
          missing: deterministicMissing,
          command: deterministicWithMissing,
        }
      : null;

  const deterministicBoard =
    deterministicWithMissing &&
    (deterministicWithMissing.action === "departures.list" ||
      deterministicWithMissing.action === "departures.window" ||
      deterministicWithMissing.action === "arrivals.list");
  if (deterministicBoard) {
    if (deterministicSuccessResult) return deterministicSuccessResult;
    if (deterministicMissingResult) return deterministicMissingResult;
  }

  const deterministicTripsSearch =
    deterministicWithMissing && deterministicWithMissing.action === "trips.search";
  if (deterministicTripsSearch) {
    if (deterministicSuccessResult) return deterministicSuccessResult;
    if (deterministicMissingResult) return deterministicMissingResult;
  }

  const router = getConfig().intentRouter;
  if (!router || !router.enabled) {
    if (deterministicSuccessResult) return deterministicSuccessResult;
    if (deterministicMissingResult) return deterministicMissingResult;
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
    if (deterministicSuccessResult) return deterministicSuccessResult;
    if (deterministicMissingResult) return deterministicMissingResult;
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
      if (deterministicSuccessResult) return deterministicSuccessResult;
      if (deterministicMissingResult) return deterministicMissingResult;
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
    if (deterministicSuccessResult) return deterministicSuccessResult;
    if (deterministicMissingResult) return deterministicMissingResult;
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
    if (deterministicSuccessResult) return deterministicSuccessResult;
    if (deterministicMissingResult) return deterministicMissingResult;
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
