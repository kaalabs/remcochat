const MAX_DESCRIPTION_LENGTH = 500;
const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 24 * 60 * 7;

export type AgendaRange =
  | { kind: "today"; timezone?: string }
  | { kind: "tomorrow"; timezone?: string }
  | { kind: "this_week"; timezone?: string; weekStart?: "monday" | "sunday" }
  | { kind: "this_month"; timezone?: string }
  | { kind: "next_n_days"; timezone?: string; days: number };

export type DateParts = {
  year: number;
  month: number;
  day: number;
};

export type TimeParts = {
  hour: number;
  minute: number;
  second?: number;
};

export function normalizeSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function getSystemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(value?: string) {
  const trimmed = String(value ?? "").trim();
  if (trimmed && isValidTimeZone(trimmed)) return trimmed;
  return getSystemTimeZone();
}

export function ensureDescription(description: string) {
  const normalized = normalizeSpaces(description);
  if (!normalized) throw new Error("Description is required.");
  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error("Description is too long.");
  }
  return normalized;
}

export function ensureDurationMinutes(durationMinutes: number) {
  const value = Math.floor(Number(durationMinutes));
  if (!Number.isFinite(value) || value < MIN_DURATION_MINUTES) {
    throw new Error("Duration must be at least 1 minute.");
  }
  if (value > MAX_DURATION_MINUTES) {
    throw new Error("Duration is too long.");
  }
  return value;
}

export function parseDateParts(value: string): DateParts {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("Invalid date.");
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error("Invalid date.");
  }
  return { year, month, day };
}

export function parseTimeParts(value: string): TimeParts {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error("Time must be in HH:MM format.");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error("Invalid time.");
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Invalid time.");
  }
  return { hour, minute, second: 0 };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUTC = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    lookup("hour"),
    lookup("minute"),
    lookup("second"),
  );
  return (asUTC - date.getTime()) / 60000;
}

export function zonedDateTimeToUtc(date: DateParts, time: TimeParts, timeZone: string) {
  const utcGuess = new Date(
    Date.UTC(
      date.year,
      date.month - 1,
      date.day,
      time.hour,
      time.minute,
      time.second ?? 0,
    ),
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

export function formatDateInZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

export function formatTimeInZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("hour")}:${lookup("minute")}`;
}

function getDatePartsInZone(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
  };
}

export function addDays(date: DateParts, days: number): DateParts {
  const base = new Date(Date.UTC(date.year, date.month - 1, date.day));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function getWeekStartDate(date: DateParts, weekStart: "monday" | "sunday") {
  const base = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const dow = base.getUTCDay();
  const offset = weekStart === "monday" ? (dow + 6) % 7 : dow;
  return addDays(date, -offset);
}

function getRangeLabel(range: AgendaRange) {
  switch (range.kind) {
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow";
    case "this_week":
      return "This week";
    case "this_month":
      return "This month";
    case "next_n_days":
      return `Next ${range.days} days`;
    default:
      return "Agenda";
  }
}

export function computeRange(range: AgendaRange, fallbackTimeZone?: string) {
  const timeZone = resolveTimeZone(range.timezone || fallbackTimeZone);
  const today = getDatePartsInZone(new Date(), timeZone);
  let startDate = today;
  let endDate = today;
  switch (range.kind) {
    case "today":
      startDate = today;
      endDate = addDays(today, 1);
      break;
    case "tomorrow":
      startDate = addDays(today, 1);
      endDate = addDays(today, 2);
      break;
    case "this_week": {
      const weekStart = range.weekStart ?? "monday";
      startDate = getWeekStartDate(today, weekStart);
      endDate = addDays(startDate, 7);
      break;
    }
    case "this_month":
      startDate = { year: today.year, month: today.month, day: 1 };
      endDate =
        today.month === 12
          ? { year: today.year + 1, month: 1, day: 1 }
          : { year: today.year, month: today.month + 1, day: 1 };
      break;
    case "next_n_days": {
      const days = Math.max(1, Math.floor(Number(range.days)));
      if (!Number.isFinite(days)) {
        throw new Error("Days must be provided for next_n_days.");
      }
      startDate = today;
      endDate = addDays(today, days);
      break;
    }
    default:
      startDate = today;
      endDate = addDays(today, 1);
  }

  const startUtc = zonedDateTimeToUtc(startDate, { hour: 0, minute: 0 }, timeZone);
  const endUtc = zonedDateTimeToUtc(endDate, { hour: 0, minute: 0 }, timeZone);
  return {
    startUtc,
    endUtc,
    timeZone,
    rangeLabel: getRangeLabel(range),
  };
}
