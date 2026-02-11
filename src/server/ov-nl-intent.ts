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

const POLICY_OR_FACILITIES_RE =
  /\b(ticket(?:s)?|kaartje(?:s)?|prijs|prijzen|kost(?:en|t)?|tarief|fare|refund(?:s)?|restitutie|terugbeta(?:al|ling)|compensatie|vergoeding|claims?|klacht(?:en)?|customer\s*service|klantenservice|contact|abonnement(?:en)?|subscription|ov-?chipkaart|chipkaart|incheck(?:en)?|uitcheck(?:en)?|check[-\s]?in|check[-\s]?out|fiets(?:en)?|bike|bicycle|bagage|luggage|locker(?:s)?|kluiz(?:en)?|bagagekluiz(?:en)?|toilet(?:ten)?|wc\b|lift(?:en)?|elevator(?:s)?|rolstoel|wheelchair|accessib|toegankelijk|assistentie|assistance|voorzieningen|facilit(?:y|ies)|openingstijden|opening\s*hours|parkeren|parking|fietsenstalling|wifi|internet)\b/i;

const LIVE_TRAVEL_SIGNAL_RE =
  /\b(vertrekbord|vertrekken|vertrektijd(?:en)?(?:bord)?|aankomstbord|aankomsten?|aankomsttijd(?:en)?(?:bord)?|spoor|perron|platform|track|dienstregeling|timetable|journey|trip|rit(?:ten)?|reisoptie(?:s)?|reisinformatie)\b/i;

export function isExplicitWebSearchRequest(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return EXPLICIT_WEB_SEARCH_RE.test(value) || EXPLICIT_SOURCES_RE.test(value);
}

export function isOvNlRailIntent(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (value.startsWith("/")) return false;

  const looksLikeLiveTravelQuery =
    ROUTE_PATTERN_RE.test(value) ||
    LIVE_TRAVEL_SIGNAL_RE.test(value) ||
    DISRUPTION_SIGNAL_RE.test(value);
  const looksLikePolicyOrFacilities = POLICY_OR_FACILITIES_RE.test(value);

  // Avoid routing policy/facilities questions to the OV tool unless the user also asks
  // about a concrete route/board/disruption (live travel data).
  if (looksLikePolicyOrFacilities && !looksLikeLiveTravelQuery) return false;

  if (looksLikeLiveTravelQuery) return true;
  if (NS_QUERY_RE.test(value)) return true;
  if (STRONG_RAIL_SIGNAL_RE.test(value)) return true;

  return false;
}

export function shouldPreferOvNlGatewayTool(input: {
  text: string;
  ovNlEnabled: boolean;
  explicitSkillName?: string | null;
  activatedSkillNames?: string[];
}): boolean {
  if (!input.ovNlEnabled) return false;

  const text = String(input.text ?? "").trim();
  if (text && isExplicitWebSearchRequest(text)) return false;

  const explicitSkillName = String(input.explicitSkillName ?? "").trim();
  const activated = Array.isArray(input.activatedSkillNames)
    ? input.activatedSkillNames.map((name) => String(name ?? "").trim())
    : [];
  const skillForced =
    explicitSkillName === OV_NL_SKILL_NAME || activated.includes(OV_NL_SKILL_NAME);

  const stripSkillPrefix = (value: string) => {
    const v = String(value ?? "");
    const prefix = `/${OV_NL_SKILL_NAME}`;
    if (!v.toLowerCase().startsWith(prefix)) return v.trim();
    return v.slice(prefix.length).trim();
  };

  const effectiveText = skillForced ? stripSkillPrefix(text) : text;
  if (!effectiveText) return false;
  return isOvNlRailIntent(effectiveText);
}
