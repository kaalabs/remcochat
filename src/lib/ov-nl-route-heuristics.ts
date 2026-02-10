export type OvNlDirectnessStrength = "none" | "preferred" | "strict";

const ROUTE_QUERY_SIGNAL_RE =
  /\b(van|from)\b[\s\S]{0,120}\b(naar|to)\b|\btussen\b[\s\S]{0,120}\ben\b|\bbetween\b[\s\S]{0,120}\band\b/i;
const ROUTE_FROM_TO_RE = /\bfrom\s+(.+?)\s+to\s+(.+?)(?:$|[.?!,;])/i;
const ROUTE_BETWEEN_AND_RE = /\bbetween\s+(.+?)\s+and\s+(.+?)(?:$|[.?!,;])/i;
const ROUTE_VAN_NAAR_RE = /\bvan\s+(.+?)\s+naar\s+(.+?)(?:$|[.?!,;])/i;
const ROUTE_TUSSEN_EN_RE = /\btussen\s+(.+?)\s+en\s+(.+?)(?:$|[.?!,;])/i;
const STATION_SEGMENT_STOP_RE =
  /\b(geef|give|toon|show|please|alstublieft|met|with|zonder|without|liefst|prefer|bij\s+voorkeur|direct|directe|rechtstreeks|treinopties|train\s+options?|om|at|vandaag|today|morgen|tomorrow|gisteren|yesterday|vanmorgen|this\s+morning|vanmiddag|this\s+afternoon|vanavond|this\s+evening|vannacht|tonight|nu|now|straks|soon)\b/i;

const STRICT_DIRECT_RE =
  /\b(zonder\s+overstap(?:pen)?|geen\s+overstap(?:pen)?|no\s+transfers?|without\s+transfers?|alleen\s+direct(?:e)?|only\s+direct|must\s+be\s+direct|moet\s+direct)\b/i;
const STRICT_MARKER_RE = /\b(alleen|only|must|moet|zonder|without|geen|no)\b/i;
const SOFT_MARKER_RE = /\b(liefst|bij\s+voorkeur|prefer(?:red)?|graag|if\s+possible)\b/i;
const DIRECT_WORD_RE = /\b(direct|directe|rechtstreeks)\b/i;
const TRANSFER_WORD_RE = /\b(overstap(?:pen)?|transfers?)\b/i;
const FEWEST_TRANSFER_RE =
  /\b(fewest\s+transfers?|least\s+transfers?|minste?\s+overstap(?:pen)?|minder\s+overstap(?:pen)?|zo\s+min\s+mogelijk\s+overstap(?:pen)?|as\s+few\s+transfers?\s+as\s+possible)\b/i;

const EXPLICIT_TIME_RE = /\b(?:om|at)\s*(\d{1,2})(?:[:.](\d{2}))\b/i;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function trimStationSegment(value: string): string {
  let out = value.trim();
  if (!out) return "";
  const stopIdx = out.search(STATION_SEGMENT_STOP_RE);
  if (stopIdx > 0) out = out.slice(0, stopIdx).trim();
  out = out.replace(/^[("'`]+/, "").replace(/[)"'`]+$/, "");
  out = out.replace(/[.,;:!?]+$/, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseHourMinute(hourRaw: string, minuteRaw: string | undefined): string | null {
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeSoftRankBy(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function pruneIntent(intent: Record<string, unknown>): Record<string, unknown> | undefined {
  const hard = asRecord(intent.hard);
  const soft = asRecord(intent.soft);

  const prunedHard: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hard)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "boolean" && value === false) continue;
    prunedHard[key] = value;
  }

  const rankBy = normalizeSoftRankBy(soft.rankBy);
  const prunedSoft = rankBy.length > 0 ? { rankBy } : undefined;

  const out: Record<string, unknown> = {};
  if (Object.keys(prunedHard).length > 0) out.hard = prunedHard;
  if (prunedSoft) out.soft = prunedSoft;
  return Object.keys(out).length > 0 ? out : undefined;
}

function removeStrictDirectOnlyFromIntent(intent: unknown): Record<string, unknown> | undefined {
  const base = asRecord(intent);
  const hard = asRecord(base.hard);
  let changed = false;

  if (hard.directOnly === true) {
    delete hard.directOnly;
    changed = true;
  }

  if (typeof hard.maxTransfers === "number" && Number.isFinite(hard.maxTransfers) && hard.maxTransfers <= 0) {
    delete hard.maxTransfers;
    changed = true;
  }

  if (!changed) return pruneIntent(base);
  return pruneIntent({ ...base, hard });
}

export function extractRouteFromText(text: string): { from: string; to: string } | null {
  const raw = text.trim();
  if (!raw) return null;
  if (!ROUTE_QUERY_SIGNAL_RE.test(raw)) return null;

  const match =
    ROUTE_VAN_NAAR_RE.exec(raw) ??
    ROUTE_TUSSEN_EN_RE.exec(raw) ??
    ROUTE_FROM_TO_RE.exec(raw) ??
    ROUTE_BETWEEN_AND_RE.exec(raw);
  if (!match) return null;

  const from = trimStationSegment(match[1] ?? "");
  const to = trimStationSegment(match[2] ?? "");
  if (!from || !to) return null;
  if (from.length > 120 || to.length > 120) return null;
  return { from, to };
}

export function inferDirectnessFromText(text: string): OvNlDirectnessStrength {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) return "none";

  if (STRICT_DIRECT_RE.test(normalized)) return "strict";
  if (STRICT_MARKER_RE.test(normalized) && DIRECT_WORD_RE.test(normalized)) return "strict";
  if (STRICT_MARKER_RE.test(normalized) && TRANSFER_WORD_RE.test(normalized)) return "strict";

  if (FEWEST_TRANSFER_RE.test(normalized)) return "preferred";

  if (DIRECT_WORD_RE.test(normalized)) {
    if (SOFT_MARKER_RE.test(normalized)) return "preferred";
    return "strict";
  }

  return "none";
}

export function inferDateTimeHintFromText(text: string): string | undefined {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) return undefined;

  const explicitTime = EXPLICIT_TIME_RE.exec(normalized);
  if (explicitTime) {
    const hhmm = parseHourMinute(explicitTime[1] ?? "", explicitTime[2]);
    if (hhmm) {
      const base =
        /\b(morgen|tomorrow)\b/.test(normalized)
          ? "tomorrow"
          : /\b(gisteren|yesterday)\b/.test(normalized)
            ? "yesterday"
            : "today";
      return `${base}@${hhmm}`;
    }
  }

  if (/\b(vanmorgen|this\s+morning)\b/.test(normalized)) return "today@09:00";
  if (/\b(vanmiddag|this\s+afternoon)\b/.test(normalized)) return "today@15:00";
  if (/\b(vanavond|this\s+evening)\b/.test(normalized)) return "today@19:00";
  if (/\b(vannacht|tonight)\b/.test(normalized)) return "today@23:30";

  if (/\b(vandaag|today)\b/.test(normalized)) return "today";
  if (/\b(morgen|tomorrow)\b/.test(normalized)) return "tomorrow";
  if (/\b(gisteren|yesterday)\b/.test(normalized)) return "yesterday";
  if (/\b(nu|now|straks|soon)\b/.test(normalized)) return "now";
  return undefined;
}

export function applyDirectnessToIntent(
  intent: unknown,
  directness: OvNlDirectnessStrength
): Record<string, unknown> | undefined {
  if (directness === "none") {
    return pruneIntent(asRecord(intent));
  }

  const base = asRecord(intent);
  const hard = asRecord(base.hard);
  const soft = asRecord(base.soft);

  if (directness === "strict") {
    hard.directOnly = true;
    hard.maxTransfers = 0;
  } else if (directness === "preferred") {
    const hasHardDirectOnly = hard.directOnly === true;
    const hasHardMaxTransfersZero =
      typeof hard.maxTransfers === "number" && Number.isFinite(hard.maxTransfers) && hard.maxTransfers <= 0;

    const rankBy = normalizeSoftRankBy(soft.rankBy);
    if (!rankBy.includes("fewest_transfers")) rankBy.unshift("fewest_transfers");
    if (!hasHardDirectOnly && !hasHardMaxTransfersZero) {
      soft.rankBy = rankBy;
    }
  }

  return pruneIntent({ ...base, hard, soft });
}

export function applyTripsTextHeuristicsToArgs(input: {
  text: string;
  args: Record<string, unknown>;
}): Record<string, unknown> {
  const nextArgs: Record<string, unknown> = { ...input.args };

  // If station strings already exist (LLM/tool carryover), strip common trailing noise like
  // date/time hints ("vandaag", "om 10:00") so station search doesn't fail.
  if (hasText(nextArgs.from)) nextArgs.from = trimStationSegment(nextArgs.from);
  if (hasText(nextArgs.to)) nextArgs.to = trimStationSegment(nextArgs.to);

  const route = extractRouteFromText(input.text);
  if (route) {
    if (!hasText(nextArgs.from)) nextArgs.from = route.from;
    if (!hasText(nextArgs.to)) nextArgs.to = route.to;
  }

  const dateTimeHint = inferDateTimeHintFromText(input.text);
  if (!hasText(nextArgs.dateTime) && dateTimeHint) {
    nextArgs.dateTime = dateTimeHint;
  }

  const directness = inferDirectnessFromText(input.text);
  if (directness !== "none") {
    const normalizedIntent = applyDirectnessToIntent(nextArgs.intent, directness);
    if (normalizedIntent) nextArgs.intent = normalizedIntent;
    else delete nextArgs.intent;
  } else {
    // If the user didn't ask for direct travel in this message, don't let an LLM/tool payload
    // accidentally force strict direct-only constraints (which leads to "no direct trips" banners).
    const normalizedIntent = removeStrictDirectOnlyFromIntent(nextArgs.intent);
    if (normalizedIntent) nextArgs.intent = normalizedIntent;
    else delete nextArgs.intent;
  }

  return nextArgs;
}
