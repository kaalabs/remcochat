const AGENDA_INTENT_RE =
  /\b(agenda|calendar|kalender|meeting|vergadering|afspraak|appointment|event|schedule|reschedule|plan|remind|herinner|herinnering)\b/i;

const TIMEZONES_INTENT_RE =
  /\b(timezone|time zone|timezones|tijdzone|tijd zones|tijdzones|utc|gmt|offset)\b/i;

const TIME_QUERY_RE =
  /\b(what time|time now|current time|time is it|local time|time in|time at|convert|conversion|difference|hoe laat|tijd nu|huidige tijd|lokale tijd|tijd in|omrekenen|verschil)\b/i;

export function isTimezonesUserQuery(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;

  if (AGENDA_INTENT_RE.test(value)) return false;
  if (TIMEZONES_INTENT_RE.test(value)) return true;
  if (TIME_QUERY_RE.test(value)) return true;

  return false;
}

