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
    const text = String(raw ?? "").trim();
    if (text) return text;
  }

  // Then scan for case/format variations (e.g. "Description", "eventName").
  for (const [key, raw] of Object.entries(record)) {
    const normalized = normalizeKey(key);
    if (!DESCRIPTION_KEYS.has(normalized)) continue;
    const text = String(raw ?? "").trim();
    if (text) return text;
  }

  return "";
}
