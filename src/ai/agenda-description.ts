const DESCRIPTION_KEYS = new Set([
  "description",
  "beschrijving",
  "omschrijving",
  "title",
  "titel",
  "subject",
  "onderwerp",
  "name",
  "event",
  "event_name",
  "content",
  "text",
  "summary",
]);

function normalizeSpaces(value: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeKey(key: string) {
  const raw = String(key ?? "").trim();
  const withUnderscores = raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return withUnderscores
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function pickAgendaDescriptionFromRecord(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;

  // Prefer canonical keys first when present.
  const preferred = [
    "description",
    "beschrijving",
    "omschrijving",
    "title",
    "titel",
    "subject",
    "onderwerp",
    "name",
    "event",
    "event_name",
    "content",
    "text",
    "summary",
  ];
  for (const key of preferred) {
    const raw = record[key];
    const text = normalizeSpaces(String(raw ?? ""));
    if (text) return text;
  }

  // Then scan for case/format variations (e.g. "Description", "eventName").
  for (const [key, raw] of Object.entries(record)) {
    const normalized = normalizeKey(key);
    if (!DESCRIPTION_KEYS.has(normalized)) continue;
    const text = normalizeSpaces(String(raw ?? ""));
    if (text) return text;
  }

  return "";
}

export function inferAgendaDescriptionFromUserText(text: string): string {
  const value = normalizeSpaces(text);
  if (!value) return "";

  const patterns: RegExp[] = [
    /\bzet\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s+in\s+mijn\s+(?:agenda|kalender)\b/i,
    /\bzet\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s+op\s+mijn\s+(?:agenda|kalender)\b/i,
    /\b(add|schedule|put)\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s+(?:to|in)\s+my\s+(?:agenda|calendar)\b/i,
  ];

  for (const re of patterns) {
    const m = value.match(re);
    if (!m) continue;
    const candidate = normalizeSpaces(String(m[1] ?? m[2] ?? m[3] ?? m[4] ?? ""));
    if (candidate) return candidate;
  }

  return "";
}
