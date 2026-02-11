import { generateText, type LanguageModel } from "ai";
import { getConfig } from "@/server/config";
import { getLanguageModelForProvider } from "@/server/llm-provider";
import { extractJsonObject } from "@/server/llm-json";
import { extractRouteFromText, inferDateTimeHintFromText, inferDirectnessFromText } from "@/lib/ov-nl-route-heuristics";
import type { OvNlToolOutput } from "@/lib/types";
import { OvQueryV1Schema, type OvQueryV1 } from "@/server/ov/query-schema";

export type OvNluResult =
  | { ok: true; query: OvQueryV1 }
  | { ok: false; missing: string[]; clarification: string; confidence: number };

const BOARD_INTENT_RE =
  /\b(vertrekbord|vertrekken|vertrektijd(?:en)?(?:bord)?|departures?|aankomstbord|aankomsten?|aankomsttijd(?:en)?(?:bord)?|arrivals?)\b/i;
const DEPARTURE_BOARD_RE = /\b(vertrekbord|vertrekken|vertrektijd(?:en)?(?:bord)?|departures?)\b/i;
const ARRIVAL_BOARD_RE = /\b(aankomstbord|aankomsten?|aankomsttijd(?:en)?(?:bord)?|arrivals?)\b/i;

const BOARD_WINDOW_PATTERNS = [
  /\btussen\s+(\d{1,2}(?::|\.)\d{2})\s+en\s+(\d{1,2}(?::|\.)\d{2})\b/i,
  /\bvan\s+(\d{1,2}(?::|\.)\d{2})\s+tot\s+(\d{1,2}(?::|\.)\d{2})\b/i,
  /\bfrom\s+(\d{1,2}(?::|\.)\d{2})\s+to\s+(\d{1,2}(?::|\.)\d{2})\b/i,
] as const;

const BOARD_STATION_PATTERNS = [
  /\bvan\s+station\s+(.+?)(?=$|[.?!,;]|\s+\b(?:tussen|om|naar|met|zonder|voor|for|from|to|between|arrivals?|departures?|vertrek(?:ken|bord|tijden?)?|aankomst(?:en|bord)?|show|toon|geef|laat|zien|please)\b)/i,
  /\bop\s+station\s+(.+?)(?=$|[.?!,;]|\s+\b(?:tussen|om|naar|met|zonder|voor|for|from|to|between|arrivals?|departures?|vertrek(?:ken|bord|tijden?)?|aankomst(?:en|bord)?|show|toon|geef|laat|zien|please)\b)/i,
  /\bstation\s+(.+?)(?=$|[.?!,;]|\s+\b(?:tussen|om|naar|met|zonder|voor|for|from|to|between|arrivals?|departures?|vertrek(?:ken|bord|tijden?)?|aankomst(?:en|bord)?|show|toon|geef|laat|zien|please)\b)/i,
  /\bvan\s+(?!\d{1,2}(?::|\.)\d{2}\b)(.+?)(?=$|[.?!,;]|\s+\b(?:tussen|om|naar|met|zonder|voor|for|from|to|between|arrivals?|departures?|vertrek(?:ken|bord|tijden?)?|aankomst(?:en|bord)?|show|toon|geef|laat|zien|please)\b)/i,
  /\bop\s+(?!\d{1,2}(?::|\.)\d{2}\b)(.+?)(?=$|[.?!,;]|\s+\b(?:tussen|om|naar|met|zonder|voor|for|from|to|between|arrivals?|departures?|vertrek(?:ken|bord|tijden?)?|aankomst(?:en|bord)?|show|toon|geef|laat|zien|please)\b)/i,
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

function deterministicOvQueryFromText(input: {
  text: string;
  lastOvOutput?: OvNlToolOutput | null;
}): OvQueryV1 | null {
  const text = input.text;

  if (BOARD_INTENT_RE.test(text)) {
    const station = extractBoardStation(text);
    const window = extractBoardWindow(text);
    const wantsArrivals = ARRIVAL_BOARD_RE.test(text) && !DEPARTURE_BOARD_RE.test(text);
    const intentKind = window
      ? "departures.window"
      : wantsArrivals
        ? "arrivals.list"
        : "departures.list";

    const stationFromContext = station || stationNameFromOutput(input.lastOvOutput);

    return {
      version: 1,
      intentKind,
      confidence: 0.95,
      isFollowUp: false,
      slots: {
        stationText: stationFromContext || undefined,
        fromTime: window?.fromTime,
        toTime: window?.toTime,
      },
      requested: {},
      missing: [],
      clarification: "",
    };
  }

  const route = extractRouteFromText(text);
  if (route) {
    const directness = inferDirectnessFromText(text);
    const dateTimeHint = inferDateTimeHintFromText(text);
    const requested: OvQueryV1["requested"] = {};
    if (directness === "strict") {
      requested.hard = { directOnly: true, maxTransfers: 0 };
    } else if (directness === "preferred") {
      requested.soft = { rankBy: ["fewest_transfers"] };
    }
    return {
      version: 1,
      intentKind: "trips.search",
      confidence: 0.95,
      isFollowUp: false,
      slots: {
        fromText: route.from,
        toText: route.to,
        dateTimeHint,
      },
      requested,
      missing: [],
      clarification: "",
    };
  }

  return null;
}

async function extractOvQueryWithPrompt(input: {
  model: LanguageModel;
  prompt: string;
  temperature?: number;
}): Promise<OvQueryV1> {
  const { text } = await generateText({
    model: input.model,
    prompt: `${input.prompt}\n\nReturn ONLY valid JSON and no other text.`,
    ...(Number.isFinite(input.temperature ?? NaN) ? { temperature: input.temperature as number } : {}),
  });
  return OvQueryV1Schema.parse(extractJsonObject(text));
}

const OV_QUERY_ROUTER_PROMPT = [
  "You are RemcoChat's OV NL NLU module.",
  "Extract a single OV query frame from the latest user message.",
  "Return JSON only, matching the provided schema exactly (no markdown, no prose).",
  "",
  "Rules:",
  "- Never output tool args for ovNlGateway.",
  "- Use intentKind to describe the user intent (trips.search, departures.list, etc).",
  "- Fill slots with literal station/route/window text from the user. Do not invent station names.",
  "- Put hard constraints under requested.hard and ranking preferences under requested.soft.",
  "- If required information is missing (station/from/to/window), set missing[] and ask one concise clarification question.",
  "",
  "Examples:",
  '- "laat het vertrekbord van station Utrecht Centraal zien" -> intentKind=departures.list, slots.stationText="Utrecht Centraal"',
  '- "tussen 18:00 en 19:00 vertrekbord station Utrecht Centraal" -> intentKind=departures.window, slots.stationText/fromTime/toTime',
  '- "van Almere Centrum naar Groningen vandaag" -> intentKind=trips.search, slots.fromText/toText/dateTimeHint="today"',
  '- "ik wil directe treinopties" -> requested.hard.directOnly=true and requested.hard.maxTransfers=0',
  "",
  "Schema (shape):",
  [
    "{",
    '  "version": 1,',
    '  "intentKind": one of ["stations.search","stations.nearest","departures.list","departures.window","arrivals.list","trips.search","trips.detail","journey.detail","disruptions.list","disruptions.by_station","disruptions.detail"],',
    '  "confidence": number 0..1,',
    '  "isFollowUp": boolean,',
    '  "slots": {',
    '    "stationText"?: string,',
    '    "fromText"?: string, "toText"?: string, "viaText"?: string,',
    '    "date"?: string, "fromTime"?: string, "toTime"?: string,',
    '    "ctxRecon"?: string,',
    '    "journeyId"?: string, "train"?: number,',
    '    "dateTimeHint"?: string',
    "  },",
    '  "requested": { "hard"?: object, "soft"?: object },',
    '  "missing": string[],',
    '  "clarification": string',
    "}",
  ].join("\n"),
].join("\n");

export async function extractOvQueryFromUserText(input: {
  text: string;
  context?: {
    previousUserText?: string;
    lastOvOutput?: OvNlToolOutput | null;
  };
}): Promise<OvNluResult> {
  const text = String(input.text ?? "").trim();
  if (!text) {
    return { ok: false, missing: ["user_text"], clarification: "What should I look up?", confidence: 0 };
  }

  const deterministic = deterministicOvQueryFromText({
    text,
    lastOvOutput: input.context?.lastOvOutput ?? null,
  });
  if (deterministic) {
    return { ok: true, query: deterministic };
  }

  const router = getConfig().intentRouter;
  if (!router || !router.enabled) {
    return {
      ok: false,
      missing: ["ov_query"],
      clarification:
        "Which route or station should I use? For example: 'van Utrecht Centraal naar Amsterdam Centraal' or 'laat het vertrekbord van station Utrecht Centraal zien'.",
      confidence: 0,
    };
  }

  let resolved: Awaited<ReturnType<typeof getLanguageModelForProvider>>;
  try {
    resolved = await getLanguageModelForProvider(router.providerId, router.modelId);
  } catch {
    return {
      ok: false,
      missing: ["ov_query"],
      clarification: "Which route or station should I use?",
      confidence: 0,
    };
  }

  const previousUserText = String(input.context?.previousUserText ?? "").trim();
  const lastOvSummary = (() => {
    try {
      const out = JSON.stringify(input.context?.lastOvOutput ?? null);
      return out.length <= 2000 ? out : `${out.slice(0, 2000)}...[truncated]`;
    } catch {
      return "unserializable";
    }
  })();

  const clipped = text.slice(0, router.maxInputChars);
  let query: OvQueryV1;
  try {
    query = await extractOvQueryWithPrompt({
      model: resolved.model,
      prompt:
        `${OV_QUERY_ROUTER_PROMPT}\n\n` +
        `Previous user message:\n"""${previousUserText.slice(0, 800)}"""\n\n` +
        `Last OV output summary:\n${lastOvSummary}\n\n` +
        `Latest user message:\n"""${clipped}"""`,
      temperature:
        resolved.capabilities.temperature && !resolved.capabilities.reasoning ? 0 : undefined,
    });
  } catch {
    try {
      query = await extractOvQueryWithPrompt({
        model: resolved.model,
        prompt:
          `${OV_QUERY_ROUTER_PROMPT}\n\n` +
          `Previous user message:\n"""${previousUserText.slice(0, 800)}"""\n\n` +
          `Last OV output summary:\n${lastOvSummary}\n\n` +
          `Latest user message:\n"""${clipped}"""\n\n` +
          "IMPORTANT: Output JSON only. No markdown. No prose.",
        temperature:
          resolved.capabilities.temperature && !resolved.capabilities.reasoning ? 0 : undefined,
      });
    } catch {
      return {
        ok: false,
        missing: ["ov_query"],
        clarification:
          "Which route or station should I use? For example: 'van Utrecht Centraal naar Amsterdam Centraal' or 'laat het vertrekbord van station Utrecht Centraal zien'.",
        confidence: 0,
      };
    }
  }

  if (query.confidence < router.minConfidence) {
    return {
      ok: false,
      missing: query.missing,
      clarification: query.clarification || "Which route or station should I use?",
      confidence: query.confidence,
    };
  }

  if (query.missing.length > 0) {
    return {
      ok: false,
      missing: query.missing,
      clarification: query.clarification || "Which details are missing so I can continue?",
      confidence: query.confidence,
    };
  }

  return { ok: true, query };
}
