const AGENDA_INTENT_RE =
  /\b(agenda|calendar|kalender|meeting|vergadering|afspraak|appointment|event|schedule|reschedule|plan|remind|herinner|herinnering)\b/i;

const TIMEZONES_INTENT_RE =
  /\b(timezone|time zone|timezones|tijdzone|tijd zones|tijdzones|utc|gmt|offset)\b/i;

const TIME_QUERY_RE =
  /\b(what time|time now|current time|time is it|local time|time in|time at|convert|conversion|difference|hoe laat|tijd nu|huidige tijd|lokale tijd|tijd in|omrekenen|verschil)\b/i;

const DATE_QUERY_RE =
  /\b(what date|today'?s date|current date|date today|what day is it|day of week|datum|vandaag.*datum|welke dag is het|welke dag is 't|dag van de week)\b/i;

const TIMEZONE_COMPARISON_RE =
  /\b(convert|conversion|difference|compare|compared to|versus|vs\.?|between|offset|omrekenen|omzetten|verschil|vergeleken met|tussen)\b/i;

const MULTI_LOCATION_TIME_QUERY_RE =
  /\b(what time|current time|local time|time is it|time in|hoe laat|huidige tijd|lokale tijd|tijd in)\b[\s\S]{0,120}(,|\band\b|\ben\b|\bcompared to\b|\bversus\b|\bvs\.?\b|\bbetween\b|\btussen\b)/i;

function isTimezoneComparisonOrMultiLocationQuery(value: string): boolean {
  if (TIMEZONE_COMPARISON_RE.test(value)) return true;
  return MULTI_LOCATION_TIME_QUERY_RE.test(value);
}

export function isTimezonesUserQuery(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;

  if (AGENDA_INTENT_RE.test(value)) return false;
  if (TIMEZONES_INTENT_RE.test(value)) return true;
  if (TIME_QUERY_RE.test(value) && isTimezoneComparisonOrMultiLocationQuery(value)) return true;

  return false;
}

export function isCurrentDateTimeUserQuery(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;

  if (AGENDA_INTENT_RE.test(value)) return false;
  if (DATE_QUERY_RE.test(value)) return true;
  if (TIME_QUERY_RE.test(value) && !isTimezoneComparisonOrMultiLocationQuery(value)) return true;

  return false;
}
