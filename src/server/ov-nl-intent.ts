export const OV_NL_SKILL_NAME = "ov-nl-travel";

const EXPLICIT_WEB_SEARCH_RE =
  /\b(web\s*search|search\s+(the\s+)?web|search\s+online|browse\s+the\s+web|internet|online|google|bing|duckduckgo|zoek\s+op\s+(het\s+)?(web|internet)|zoek\s+online)\b/i;

const EXPLICIT_SOURCES_RE =
  /\b(with|met)\s+(sources?|bronnen|links?)\b|\b(source|bron)\s+urls?\b/i;

const STRONG_RAIL_SIGNAL_RE =
  /\b(ns|n\.s\.|trein(?:en|reis|reizen|rit|ritten|optie|opties)?|intercity|sprinter|spoor|perron|station|vertrek(?:ken|tijd(?:en)?)?|aankomst(?:en|tijd(?:en)?)?|overstap(?:pen)?|reisoptie(?:s)?|dienstregeling|reisinformatie|rail|train|trains|departure|departures|arrival|arrivals|platform|track|timetable|journey|journeys)\b/i;

const DISRUPTION_SIGNAL_RE =
  /\b(storing(?:en)?|verstoring(?:en)?|vertraging(?:en)?|uitval|calamity|disruption(?:s)?|maintenance|cancelled|canceled|delay|delays)\b/i;

const ROUTE_PATTERN_RE =
  /\b(van|from)\b[\s\S]{0,120}\b(naar|to)\b|\btussen\b[\s\S]{0,120}\ben\b/i;
const NS_QUERY_RE = /\b(met|by|via)\s+ns\b|\bns\s+app\b/i;

export function isExplicitWebSearchRequest(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return EXPLICIT_WEB_SEARCH_RE.test(value) || EXPLICIT_SOURCES_RE.test(value);
}

export function isOvNlRailIntent(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (value.startsWith("/")) return false;

  if (STRONG_RAIL_SIGNAL_RE.test(value)) return true;
  if (NS_QUERY_RE.test(value)) return true;
  if (DISRUPTION_SIGNAL_RE.test(value) && ROUTE_PATTERN_RE.test(value)) return true;

  return false;
}

export function shouldPreferOvNlGatewayTool(input: {
  text: string;
  ovNlEnabled: boolean;
  explicitSkillName?: string | null;
  activatedSkillNames?: string[];
}): boolean {
  if (!input.ovNlEnabled) return false;

  const explicitSkillName = String(input.explicitSkillName ?? "").trim();
  const activated = Array.isArray(input.activatedSkillNames)
    ? input.activatedSkillNames.map((name) => String(name ?? "").trim())
    : [];
  if (
    explicitSkillName === OV_NL_SKILL_NAME ||
    activated.includes(OV_NL_SKILL_NAME)
  ) {
    return true;
  }

  const text = String(input.text ?? "").trim();
  if (!text) return false;
  if (isExplicitWebSearchRequest(text)) return false;

  return isOvNlRailIntent(text);
}
