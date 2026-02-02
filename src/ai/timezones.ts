export type TimezoneEntry = {
  label: string;
  timeZone: string;
  localTime: string;
  dateLabel: string;
  localDateISO: string;
  localDateTimeISO: string;
  offset: string;
  dayDiff: number;
  isReference: boolean;
};

export type TimezonesToolOutput = {
  mode: "now" | "converted";
  reference: {
    label: string;
    timeZone: string;
    localTime: string;
    dateLabel: string;
    localDateISO: string;
    localDateTimeISO: string;
  };
  entries: TimezoneEntry[];
};

const MAX_ZONES = 8;

const TIMEZONE_ALIASES: Array<{
  label: string;
  timeZone: string;
  keys: string[];
}> = [
  { label: "UTC", timeZone: "UTC", keys: ["utc", "gmt", "zulu"] },
  {
    label: "Amsterdam",
    timeZone: "Europe/Amsterdam",
    keys: ["amsterdam", "rotterdam", "netherlands", "holland", "nl"],
  },
  {
    label: "London",
    timeZone: "Europe/London",
    keys: ["london", "uk", "england", "britain", "gb"],
  },
  { label: "Paris", timeZone: "Europe/Paris", keys: ["paris"] },
  { label: "Berlin", timeZone: "Europe/Berlin", keys: ["berlin"] },
  { label: "Madrid", timeZone: "Europe/Madrid", keys: ["madrid"] },
  { label: "Rome", timeZone: "Europe/Rome", keys: ["rome"] },
  {
    label: "New York",
    timeZone: "America/New_York",
    keys: ["new york", "nyc", "eastern", "est", "edt"],
  },
  {
    label: "Chicago",
    timeZone: "America/Chicago",
    keys: ["chicago", "central", "cst", "cdt"],
  },
  {
    label: "Denver",
    timeZone: "America/Denver",
    keys: ["denver", "mountain", "mst", "mdt"],
  },
  {
    label: "Los Angeles",
    timeZone: "America/Los_Angeles",
    keys: ["los angeles", "la", "san francisco", "sf", "pacific", "pst", "pdt"],
  },
  {
    label: "Phoenix",
    timeZone: "America/Phoenix",
    keys: ["phoenix"],
  },
  {
    label: "Mexico City",
    timeZone: "America/Mexico_City",
    keys: ["mexico city"],
  },
  {
    label: "Sao Paulo",
    timeZone: "America/Sao_Paulo",
    keys: ["sao paulo"],
  },
  {
    label: "Buenos Aires",
    timeZone: "America/Argentina/Buenos_Aires",
    keys: ["buenos aires"],
  },
  {
    label: "Johannesburg",
    timeZone: "Africa/Johannesburg",
    keys: ["johannesburg", "south africa"],
  },
  { label: "Cairo", timeZone: "Africa/Cairo", keys: ["cairo"] },
  { label: "Nairobi", timeZone: "Africa/Nairobi", keys: ["nairobi"] },
  { label: "Dubai", timeZone: "Asia/Dubai", keys: ["dubai"] },
  { label: "Riyadh", timeZone: "Asia/Riyadh", keys: ["riyadh"] },
  {
    label: "Mumbai",
    timeZone: "Asia/Kolkata",
    keys: ["mumbai", "india", "ist"],
  },
  { label: "Bangkok", timeZone: "Asia/Bangkok", keys: ["bangkok"] },
  { label: "Singapore", timeZone: "Asia/Singapore", keys: ["singapore"] },
  {
    label: "Hong Kong",
    timeZone: "Asia/Hong_Kong",
    keys: ["hong kong"],
  },
  {
    label: "Shanghai",
    timeZone: "Asia/Shanghai",
    keys: ["shanghai", "beijing", "china"],
  },
  { label: "Tokyo", timeZone: "Asia/Tokyo", keys: ["tokyo", "japan", "jst"] },
  { label: "Seoul", timeZone: "Asia/Seoul", keys: ["seoul", "korea"] },
  {
    label: "Sydney",
    timeZone: "Australia/Sydney",
    keys: ["sydney", "australia"],
  },
  {
    label: "Melbourne",
    timeZone: "Australia/Melbourne",
    keys: ["melbourne"],
  },
  {
    label: "Auckland",
    timeZone: "Pacific/Auckland",
    keys: ["auckland", "new zealand"],
  },
  {
    label: "Honolulu",
    timeZone: "Pacific/Honolulu",
    keys: ["honolulu", "hawaii"],
  },
];

const DEFAULT_ZONES = [
  "Amsterdam",
  "London",
  "New York",
  "Dubai",
  "Tokyo",
  "Sydney",
];

const CURRENT_TIME_TOKENS = new Set([
  "now",
  "right now",
  "current",
  "current time",
  "present",
  "today",
]);

type GeocodingResult = {
  name: string;
  admin1?: string;
  country?: string;
  timezone?: string;
};

const aliasMap = new Map<string, { timeZone: string; label: string }>();
for (const entry of TIMEZONE_ALIASES) {
  for (const key of entry.keys) {
    aliasMap.set(normalizeKey(key), {
      timeZone: entry.timeZone,
      label: entry.label,
    });
  }
}

function normalizeSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeReferenceTime(value?: string) {
  const normalized = normalizeSpaces(String(value ?? ""));
  if (!normalized) return undefined;
  const key = normalized.toLowerCase();
  if (CURRENT_TIME_TOKENS.has(key)) return undefined;
  return normalized;
}

function normalizeReferenceZone(value?: string) {
  const normalized = normalizeSpaces(String(value ?? ""));
  return normalized || undefined;
}

function normalizeKey(value: string) {
  return normalizeSpaces(value).toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function prettifyZoneName(timeZone: string) {
  if (timeZone.toUpperCase() === "UTC") return "UTC";
  const parts = timeZone.split("/");
  const name = parts[parts.length - 1] ?? timeZone;
  return name.replace(/_/g, " ");
}

function formatResolvedLocation(result: GeocodingResult) {
  const parts = [
    result.name,
    result.admin1?.trim() || "",
    result.country?.trim() || "",
  ].filter(Boolean);
  return parts.join(", ");
}

async function geocodeZone(input: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", input);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Geocoding failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    results?: Array<GeocodingResult>;
  };

  const first = json.results?.[0];
  if (!first || !first.timezone) {
    throw new Error(`Unknown timezone: "${input}".`);
  }
  if (!isValidTimeZone(first.timezone)) {
    throw new Error(`Unknown timezone: "${input}".`);
  }

  return {
    timeZone: first.timezone,
    label: formatResolvedLocation(first),
  };
}

async function resolveZone(input: string) {
  const raw = normalizeSpaces(String(input ?? ""));
  if (!raw) throw new Error("Missing timezone.");
  const alias = aliasMap.get(normalizeKey(raw));
  if (alias) return alias;
  if (isValidTimeZone(raw)) {
    return { timeZone: raw, label: prettifyZoneName(raw) };
  }
  const normalized = raw.replace(/\s+/g, "_");
  if (normalized !== raw && isValidTimeZone(normalized)) {
    return { timeZone: normalized, label: prettifyZoneName(normalized) };
  }
  return geocodeZone(raw);
}

function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const data: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      data[part.type] = Number(part.value);
    }
  }
  return {
    year: data.year ?? 0,
    month: data.month ?? 1,
    day: data.day ?? 1,
    hour: data.hour ?? 0,
    minute: data.minute ?? 0,
    second: data.second ?? 0,
  };
}

function getOffsetMinutes(timeZone: string, date: Date) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return (asUtc - date.getTime()) / 60000;
}

function formatOffset(timeZone: string, date: Date) {
  const offsetMinutes = Math.round(getOffsetMinutes(timeZone, date));
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function formatTime(date: Date, timeZone: string) {
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  return { time, dateLabel };
}

function pad2(value: number) {
  return String(Math.trunc(value)).padStart(2, "0");
}

function buildLocalDateISO(parts: { year: number; month: number; day: number }) {
  return `${String(parts.year).padStart(4, "0")}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function buildLocalDateTimeISO(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}) {
  const date = buildLocalDateISO(parts);
  return `${date}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function parseTimeInput(raw: string, referenceZone: string) {
  const value = normalizeSpaces(raw);
  const dateTimeMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?\s*(AM|PM)?$/i
  );
  const timeMatch = value.match(
    /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?$/i
  );

  const nowParts = getZonedParts(new Date(), referenceZone);

  let year = nowParts.year;
  let month = nowParts.month;
  let day = nowParts.day;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let meridiem: string | undefined;

  if (dateTimeMatch) {
    year = Number(dateTimeMatch[1]);
    month = Number(dateTimeMatch[2]);
    day = Number(dateTimeMatch[3]);
    hour = Number(dateTimeMatch[4] ?? "0");
    minute = Number(dateTimeMatch[5] ?? "0");
    second = Number(dateTimeMatch[6] ?? "0");
    meridiem = dateTimeMatch[7]?.toUpperCase();
  } else if (timeMatch) {
    hour = Number(timeMatch[1] ?? "0");
    minute = Number(timeMatch[2] ?? "0");
    second = Number(timeMatch[3] ?? "0");
    meridiem = timeMatch[4]?.toUpperCase();
  } else {
    throw new Error(
      'Use a time like "09:30" or "2026-01-16 09:30".'
    );
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      throw new Error("Hour must be between 1 and 12 for AM/PM times.");
    }
    if (meridiem === "AM") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  }

  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error("Invalid time values.");
  }

  return { year, month, day, hour, minute, second };
}

function zonedTimeToUtc(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}, timeZone: string) {
  const naive = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
  );
  const offset = getOffsetMinutes(timeZone, naive);
  let utc = new Date(naive.getTime() - offset * 60000);

  const actual = getZonedParts(utc, timeZone);
  const desiredUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const actualUtc = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second
  );
  if (desiredUtc !== actualUtc) {
    utc = new Date(utc.getTime() + (desiredUtc - actualUtc));
  }
  return utc;
}

export async function getTimezones(input: {
  zones?: string[];
  referenceZone?: string;
  referenceTime?: string;
}): Promise<TimezonesToolOutput> {
  const referenceTime = normalizeReferenceTime(input.referenceTime);
  const referenceZoneInput = normalizeReferenceZone(input.referenceZone);
  const rawZones = Array.isArray(input.zones) ? input.zones : [];
  const zoneInputs = rawZones
    .map((zone) => normalizeSpaces(String(zone ?? "")))
    .filter(Boolean);
  const seeds = zoneInputs.length > 0 ? zoneInputs : DEFAULT_ZONES;

  const resolved: Array<{ timeZone: string; label: string }> = [];
  const seen = new Set<string>();
  for (const zone of seeds) {
    const found = await resolveZone(zone);
    if (seen.has(found.timeZone)) continue;
    seen.add(found.timeZone);
    resolved.push(found);
    if (resolved.length >= MAX_ZONES) break;
  }

  if (resolved.length === 0) {
    throw new Error("No timezones provided.");
  }

  if (referenceTime && !referenceZoneInput && resolved.length > 1) {
    throw new Error("Reference zone is required for specific times.");
  }

  const reference = referenceZoneInput
    ? await resolveZone(referenceZoneInput)
    : resolved[0];

  if (!seen.has(reference.timeZone)) {
    resolved.unshift(reference);
  }

  const referenceInstant = referenceTime
    ? zonedTimeToUtc(
        parseTimeInput(referenceTime, reference.timeZone),
        reference.timeZone
      )
    : new Date();

  const referenceFormatted = formatTime(referenceInstant, reference.timeZone);
  const referenceParts = getZonedParts(referenceInstant, reference.timeZone);
  const referenceLocalDateISO = buildLocalDateISO(referenceParts);
  const referenceLocalDateTimeISO = buildLocalDateTimeISO(referenceParts);
  const referenceDayKey = Date.UTC(
    getZonedParts(referenceInstant, reference.timeZone).year,
    getZonedParts(referenceInstant, reference.timeZone).month - 1,
    getZonedParts(referenceInstant, reference.timeZone).day
  );

  const entries = resolved.map((zone) => {
    const formatted = formatTime(referenceInstant, zone.timeZone);
    const zoneParts = getZonedParts(referenceInstant, zone.timeZone);
    const localDateISO = buildLocalDateISO(zoneParts);
    const localDateTimeISO = buildLocalDateTimeISO(zoneParts);
    const zoneDayKey = Date.UTC(
      zoneParts.year,
      zoneParts.month - 1,
      zoneParts.day
    );
    const dayDiff = Math.round((zoneDayKey - referenceDayKey) / 86400000);
    return {
      label: zone.label,
      timeZone: zone.timeZone,
      localTime: formatted.time,
      dateLabel: formatted.dateLabel,
      localDateISO,
      localDateTimeISO,
      offset: formatOffset(zone.timeZone, referenceInstant),
      dayDiff,
      isReference: zone.timeZone === reference.timeZone,
    };
  });

  return {
    mode: referenceTime ? "converted" : "now",
    reference: {
      label: referenceTime ? "Reference" : "Now",
      timeZone: reference.timeZone,
      localTime: referenceFormatted.time,
      dateLabel: referenceFormatted.dateLabel,
      localDateISO: referenceLocalDateISO,
      localDateTimeISO: referenceLocalDateTimeISO,
    },
    entries,
  };
}
