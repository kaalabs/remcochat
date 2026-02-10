import { nanoid } from "nanoid";
import { getDb } from "@/server/db";
import { listProfiles } from "@/server/profiles";
import type { AgendaItem, AgendaToolOutput } from "@/lib/types";

const MAX_DESCRIPTION_LENGTH = 500;
const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 24 * 60 * 7;

type AgendaRange =
  | { kind: "today"; timezone?: string }
  | { kind: "tomorrow"; timezone?: string }
  | { kind: "this_week"; timezone?: string; weekStart?: "monday" | "sunday" }
  | { kind: "this_month"; timezone?: string }
  | { kind: "next_n_days"; timezone?: string; days: number };

export type AgendaActionInput =
  | {
      action: "create";
      description: string;
      date: string;
      time: string;
      durationMinutes: number;
      timezone?: string;
    }
  | {
      action: "update";
      itemId?: string;
      match?: { description?: string; date?: string; time?: string };
      patch: Partial<{
        description: string;
        date: string;
        time: string;
        durationMinutes: number;
        timezone: string;
      }>;
    }
  | {
      action: "delete";
      itemId?: string;
      match?: { description?: string; date?: string; time?: string };
    }
  | {
      action: "share" | "unshare";
      itemId?: string;
      match?: { description?: string; date?: string; time?: string };
      targetProfile: string;
    }
  | {
      action: "list";
      range: AgendaRange;
      includeOverlaps?: boolean;
    };

type AgendaItemRow = {
  id: string;
  profile_id: string;
  description: string;
  start_at: string;
  duration_minutes: number;
  timezone: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  owner_name?: string;
  shared_with_count?: number;
  scope?: "owned" | "shared";
};

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type TimeParts = {
  hour: number;
  minute: number;
  second?: number;
};

function normalizeSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function getSystemTimeZone() {
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

function resolveTimeZone(value?: string) {
  const trimmed = String(value ?? "").trim();
  if (trimmed && isValidTimeZone(trimmed)) return trimmed;
  return getSystemTimeZone();
}

function ensureDescription(description: string) {
  const normalized = normalizeSpaces(description);
  if (!normalized) throw new Error("Description is required.");
  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error("Description is too long.");
  }
  return normalized;
}

function ensureDurationMinutes(durationMinutes: number) {
  const value = Math.floor(Number(durationMinutes));
  if (!Number.isFinite(value) || value < MIN_DURATION_MINUTES) {
    throw new Error("Duration must be at least 1 minute.");
  }
  if (value > MAX_DURATION_MINUTES) {
    throw new Error("Duration is too long.");
  }
  return value;
}

function parseDateParts(value: string): DateParts {
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

function parseTimeParts(value: string): TimeParts {
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
    lookup("second")
  );
  return (asUTC - date.getTime()) / 60000;
}

function zonedDateTimeToUtc(
  date: DateParts,
  time: TimeParts,
  timeZone: string
) {
  const utcGuess = new Date(
    Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second ?? 0)
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function formatDateInZone(date: Date, timeZone: string) {
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

function formatTimeInZone(date: Date, timeZone: string) {
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

function addDays(date: DateParts, days: number): DateParts {
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
  const dow = base.getUTCDay(); // 0 (Sun) - 6 (Sat)
  const offset =
    weekStart === "monday" ? (dow + 6) % 7 : dow;
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

function computeRange(range: AgendaRange, fallbackTimeZone?: string) {
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
    case "this_month": {
      startDate = { year: today.year, month: today.month, day: 1 };
      const nextMonth =
        today.month === 12
          ? { year: today.year + 1, month: 1, day: 1 }
          : { year: today.year, month: today.month + 1, day: 1 };
      endDate = nextMonth;
      break;
    }
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

function resolveProfileIdentifier(input: string) {
  const normalized = normalizeSpaces(input);
  if (!normalized) throw new Error("Target profile is required.");
  const profiles = listProfiles();
  const byId = profiles.find((profile) => profile.id === normalized);
  if (byId) return byId;
  const byName = profiles.find(
    (profile) => profile.name.toLowerCase() === normalized.toLowerCase()
  );
  if (byName) return byName;
  throw new Error(`Profile not found: "${normalized}".`);
}

function rowToAgendaItem(row: AgendaItemRow, viewerTimeZone: string): AgendaItem {
  const start = new Date(row.start_at);
  const end = new Date(start.getTime() + row.duration_minutes * 60_000);
  const itemTimeZone = resolveTimeZone(row.timezone);
  const viewerZone = resolveTimeZone(viewerTimeZone);

  return {
    id: row.id,
    profileId: row.profile_id,
    description: row.description,
    startAt: row.start_at,
    endAt: end.toISOString(),
    durationMinutes: row.duration_minutes,
    timezone: itemTimeZone,
    ownerProfileId: row.profile_id,
    ownerProfileName: row.owner_name,
    scope: row.scope ?? "owned",
    sharedWithCount: row.shared_with_count ?? 0,
    localDate: formatDateInZone(start, itemTimeZone),
    localTime: formatTimeInZone(start, itemTimeZone),
    viewerLocalDate: formatDateInZone(start, viewerZone),
    viewerLocalTime: formatTimeInZone(start, viewerZone),
  };
}

function listAgendaRows(input: {
  profileId: string;
  rangeStartUtc: Date;
  rangeEndUtc: Date;
  includeOverlaps: boolean;
}) {
  const db = getDb();
  const startSeconds = Math.floor(input.rangeStartUtc.getTime() / 1000);
  const endSeconds = Math.floor(input.rangeEndUtc.getTime() / 1000);

  const overlapClause = input.includeOverlaps
    ? "CAST(strftime('%s', start_at) AS INTEGER) < ? AND CAST(strftime('%s', start_at, '+' || duration_minutes || ' minutes') AS INTEGER) > ?"
    : "CAST(strftime('%s', start_at) AS INTEGER) >= ? AND CAST(strftime('%s', start_at) AS INTEGER) < ?";

  const rows = db
    .prepare(
      `
        SELECT
          agenda_items.id as id,
          agenda_items.profile_id as profile_id,
          agenda_items.description as description,
          agenda_items.start_at as start_at,
          agenda_items.duration_minutes as duration_minutes,
          agenda_items.timezone as timezone,
          agenda_items.created_at as created_at,
          agenda_items.updated_at as updated_at,
          agenda_items.deleted_at as deleted_at,
          profiles.name as owner_name,
          (
            SELECT COUNT(1)
            FROM agenda_item_members
            WHERE agenda_item_members.agenda_item_id = agenda_items.id
          ) as shared_with_count,
          CASE
            WHEN agenda_items.profile_id = ? THEN 'owned'
            ELSE 'shared'
          END as scope
        FROM agenda_items
        JOIN profiles
          ON profiles.id = agenda_items.profile_id
        LEFT JOIN agenda_item_members
          ON agenda_item_members.agenda_item_id = agenda_items.id
         AND agenda_item_members.profile_id = ?
        WHERE agenda_items.deleted_at IS NULL
          AND (
            agenda_items.profile_id = ?
            OR agenda_item_members.profile_id = ?
          )
          AND ${overlapClause}
        ORDER BY agenda_items.start_at ASC
      `
    )
    .all(
      input.profileId,
      input.profileId,
      input.profileId,
      input.profileId,
      ...(input.includeOverlaps
        ? [endSeconds, startSeconds]
        : [startSeconds, endSeconds])
    ) as AgendaItemRow[];

  return rows;
}

export function listProfileAgendaItems(profileId: string): AgendaItem[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          agenda_items.id as id,
          agenda_items.profile_id as profile_id,
          agenda_items.description as description,
          agenda_items.start_at as start_at,
          agenda_items.duration_minutes as duration_minutes,
          agenda_items.timezone as timezone,
          agenda_items.created_at as created_at,
          agenda_items.updated_at as updated_at,
          agenda_items.deleted_at as deleted_at,
          profiles.name as owner_name,
          (
            SELECT COUNT(1)
            FROM agenda_item_members
            WHERE agenda_item_members.agenda_item_id = agenda_items.id
          ) as shared_with_count,
          CASE
            WHEN agenda_items.profile_id = ? THEN 'owned'
            ELSE 'shared'
          END as scope
        FROM agenda_items
        JOIN profiles
          ON profiles.id = agenda_items.profile_id
        LEFT JOIN agenda_item_members
          ON agenda_item_members.agenda_item_id = agenda_items.id
         AND agenda_item_members.profile_id = ?
        WHERE agenda_items.deleted_at IS NULL
          AND (
            agenda_items.profile_id = ?
            OR agenda_item_members.profile_id = ?
          )
        ORDER BY agenda_items.start_at ASC
      `
    )
    .all(profileId, profileId, profileId, profileId) as AgendaItemRow[];

  const viewerZone = getSystemTimeZone();
  return rows.map((row) => rowToAgendaItem(row, viewerZone));
}

function getAgendaItemById(profileId: string, itemId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          agenda_items.id as id,
          agenda_items.profile_id as profile_id,
          agenda_items.description as description,
          agenda_items.start_at as start_at,
          agenda_items.duration_minutes as duration_minutes,
          agenda_items.timezone as timezone,
          agenda_items.created_at as created_at,
          agenda_items.updated_at as updated_at,
          agenda_items.deleted_at as deleted_at,
          profiles.name as owner_name,
          (
            SELECT COUNT(1)
            FROM agenda_item_members
            WHERE agenda_item_members.agenda_item_id = agenda_items.id
          ) as shared_with_count,
          CASE
            WHEN agenda_items.profile_id = ? THEN 'owned'
            ELSE 'shared'
          END as scope
        FROM agenda_items
        JOIN profiles
          ON profiles.id = agenda_items.profile_id
        LEFT JOIN agenda_item_members
          ON agenda_item_members.agenda_item_id = agenda_items.id
         AND agenda_item_members.profile_id = ?
        WHERE agenda_items.id = ?
          AND agenda_items.deleted_at IS NULL
          AND (
            agenda_items.profile_id = ?
            OR agenda_item_members.profile_id = ?
          )
      `
    )
    .get(profileId, profileId, itemId, profileId, profileId) as
    | AgendaItemRow
    | undefined;

  return row ?? null;
}

function findAgendaCandidates(input: {
  profileId: string;
  match: { description?: string; date?: string; time?: string };
  timeZone?: string;
}) {
  const db = getDb();
  const description = normalizeSpaces(String(input.match.description ?? ""));
  const filters: string[] = [];
  const params: Array<string | number> = [
    input.profileId,
    input.profileId,
    input.profileId,
    input.profileId,
  ];

  if (description) {
    filters.push("lower(agenda_items.description) LIKE ?");
    params.push(`%${description.toLowerCase()}%`);
  }

  if (input.match.date) {
    const date = parseDateParts(input.match.date);
    const tz = resolveTimeZone(input.timeZone);
    const start = zonedDateTimeToUtc(date, { hour: 0, minute: 0 }, tz);
    const end = zonedDateTimeToUtc(addDays(date, 1), { hour: 0, minute: 0 }, tz);
    filters.push("CAST(strftime('%s', agenda_items.start_at) AS INTEGER) >= ?");
    filters.push("CAST(strftime('%s', agenda_items.start_at) AS INTEGER) < ?");
    params.push(
      Math.floor(start.getTime() / 1000),
      Math.floor(end.getTime() / 1000)
    );
  }

  if (input.match.time && input.match.date) {
    const date = parseDateParts(input.match.date);
    const time = parseTimeParts(input.match.time);
    const tz = resolveTimeZone(input.timeZone);
    const target = zonedDateTimeToUtc(date, time, tz);
    const windowStart = new Date(target.getTime() - 5 * 60_000);
    const windowEnd = new Date(target.getTime() + 5 * 60_000);
    filters.push("CAST(strftime('%s', agenda_items.start_at) AS INTEGER) >= ?");
    filters.push("CAST(strftime('%s', agenda_items.start_at) AS INTEGER) <= ?");
    params.push(
      Math.floor(windowStart.getTime() / 1000),
      Math.floor(windowEnd.getTime() / 1000)
    );
  }

  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `
        SELECT
          agenda_items.id as id,
          agenda_items.profile_id as profile_id,
          agenda_items.description as description,
          agenda_items.start_at as start_at,
          agenda_items.duration_minutes as duration_minutes,
          agenda_items.timezone as timezone,
          agenda_items.created_at as created_at,
          agenda_items.updated_at as updated_at,
          agenda_items.deleted_at as deleted_at,
          profiles.name as owner_name,
          (
            SELECT COUNT(1)
            FROM agenda_item_members
            WHERE agenda_item_members.agenda_item_id = agenda_items.id
          ) as shared_with_count,
          CASE
            WHEN agenda_items.profile_id = ? THEN 'owned'
            ELSE 'shared'
          END as scope
        FROM agenda_items
        JOIN profiles
          ON profiles.id = agenda_items.profile_id
        LEFT JOIN agenda_item_members
          ON agenda_item_members.agenda_item_id = agenda_items.id
         AND agenda_item_members.profile_id = ?
        WHERE agenda_items.deleted_at IS NULL
          AND (
            agenda_items.profile_id = ?
            OR agenda_item_members.profile_id = ?
          )
          ${where}
        ORDER BY agenda_items.start_at ASC
        LIMIT 10
      `
    )
    .all(...params) as AgendaItemRow[];

  return rows;
}

function createAgendaItem(input: {
  profileId: string;
  description: string;
  date: string;
  time: string;
  durationMinutes: number;
  timezone?: string;
}) {
  const description = ensureDescription(input.description);
  const durationMinutes = ensureDurationMinutes(input.durationMinutes);
  const dateParts = parseDateParts(input.date);
  const timeParts = parseTimeParts(input.time);
  const timeZone = resolveTimeZone(input.timezone);
  const startUtc = zonedDateTimeToUtc(dateParts, timeParts, timeZone);
  const id = nanoid();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `
      INSERT INTO agenda_items (
        id,
        profile_id,
        description,
        start_at,
        duration_minutes,
        timezone,
        created_at,
        updated_at,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `
  ).run(
    id,
    input.profileId,
    description,
    startUtc.toISOString(),
    durationMinutes,
    timeZone,
    now,
    now
  );
  return getAgendaItemById(input.profileId, id)!;
}

function updateAgendaItem(input: {
  item: AgendaItemRow;
  patch: Partial<{
    description: string;
    date: string;
    time: string;
    durationMinutes: number;
    timezone: string;
  }>;
}) {
  const db = getDb();
  const currentStart = new Date(input.item.start_at);
  const currentTimeZone = resolveTimeZone(input.item.timezone);
  const baseDate = formatDateInZone(currentStart, currentTimeZone);
  const baseTime = formatTimeInZone(currentStart, currentTimeZone);

  const nextDescription =
    input.patch.description != null
      ? ensureDescription(input.patch.description)
      : input.item.description;
  const nextDate = input.patch.date ?? baseDate;
  const nextTime = input.patch.time ?? baseTime;
  const nextDuration =
    input.patch.durationMinutes != null
      ? ensureDurationMinutes(input.patch.durationMinutes)
      : input.item.duration_minutes;
  const nextTimeZone =
    input.patch.timezone != null
      ? resolveTimeZone(input.patch.timezone)
      : currentTimeZone;

  const dateParts = parseDateParts(nextDate);
  const timeParts = parseTimeParts(nextTime);
  const startUtc = zonedDateTimeToUtc(dateParts, timeParts, nextTimeZone);
  const now = new Date().toISOString();

  db.prepare(
    `
      UPDATE agenda_items
      SET description = ?,
          start_at = ?,
          duration_minutes = ?,
          timezone = ?,
          updated_at = ?
      WHERE id = ?
    `
  ).run(
    nextDescription,
    startUtc.toISOString(),
    nextDuration,
    nextTimeZone,
    now,
    input.item.id
  );

  return getAgendaItemById(input.item.profile_id, input.item.id)!;
}

function markAgendaItemDeleted(item: AgendaItemRow) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agenda_items SET deleted_at = ?, updated_at = ? WHERE id = ?`
  ).run(now, now, item.id);
}

function shareAgendaItem(item: AgendaItemRow, targetProfileId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT OR IGNORE INTO agenda_item_members (agenda_item_id, profile_id, created_at)
      VALUES (?, ?, ?)
    `
  ).run(item.id, targetProfileId, now);
}

function unshareAgendaItem(item: AgendaItemRow, targetProfileId: string) {
  const db = getDb();
  db.prepare(
    `DELETE FROM agenda_item_members WHERE agenda_item_id = ? AND profile_id = ?`
  ).run(item.id, targetProfileId);
}

function resolveAgendaItem(input: {
  profileId: string;
  itemId?: string;
  match?: { description?: string; date?: string; time?: string };
  timeZone?: string;
}) {
  if (input.itemId) {
    const row = getAgendaItemById(input.profileId, input.itemId);
    if (!row) return { item: null, candidates: [] };
    return { item: row, candidates: [row] };
  }

  const match = input.match ?? {};
  const hasMatch =
    Boolean(match.description) || Boolean(match.date) || Boolean(match.time);
  if (!hasMatch) return { item: null, candidates: [] };
  const candidates = findAgendaCandidates({
    profileId: input.profileId,
    match,
    timeZone: input.timeZone,
  });
  if (candidates.length === 1) {
    return { item: candidates[0] ?? null, candidates };
  }
  return { item: null, candidates };
}

function ensureOwner(profileId: string, item: AgendaItemRow) {
  if (item.profile_id !== profileId) {
    throw new Error("Only the item owner can modify it.");
  }
}

function buildCandidatesOutput(
  candidates: AgendaItemRow[],
  viewerTimeZone: string
): AgendaToolOutput {
  const items = candidates.map((row) => rowToAgendaItem(row, viewerTimeZone));
  return {
    ok: false,
    error: "Multiple matching agenda items found. Please specify which one.",
    candidates: items,
  };
}

export function runAgendaAction(
  profileId: string,
  input: AgendaActionInput,
  options?: { viewerTimeZone?: string }
): AgendaToolOutput {
  const viewerZone = resolveTimeZone(options?.viewerTimeZone);

  switch (input.action) {
    case "create": {
      const row = createAgendaItem({
        profileId,
        description: input.description,
        date: input.date,
        time: input.time,
        durationMinutes: input.durationMinutes,
        timezone: input.timezone ?? viewerZone,
      });
      const item = rowToAgendaItem(row, viewerZone);
      return {
        ok: true,
        action: "create",
        message: "Agenda item added.",
        item,
      };
    }
    case "update": {
      const resolved = resolveAgendaItem({
        profileId,
        itemId: input.itemId,
        match: input.match,
        timeZone: input.patch?.timezone ?? viewerZone,
      });
      if (!resolved.item) {
        if (resolved.candidates.length > 1) {
          return buildCandidatesOutput(resolved.candidates, viewerZone);
        }
        return { ok: false, error: "Agenda item not found." };
      }
      ensureOwner(profileId, resolved.item);
      const row = updateAgendaItem({
        item: resolved.item,
        patch: input.patch,
      });
      const item = rowToAgendaItem(row, viewerZone);
      return {
        ok: true,
        action: "update",
        message: "Agenda item updated.",
        item,
      };
    }
    case "delete": {
      const resolved = resolveAgendaItem({
        profileId,
        itemId: input.itemId,
        match: input.match,
        timeZone: viewerZone,
      });
      if (!resolved.item) {
        if (resolved.candidates.length > 1) {
          return buildCandidatesOutput(resolved.candidates, viewerZone);
        }
        return { ok: false, error: "Agenda item not found." };
      }
      ensureOwner(profileId, resolved.item);
      markAgendaItemDeleted(resolved.item);
      return {
        ok: true,
        action: "delete",
        message: "Agenda item deleted.",
        item: rowToAgendaItem(resolved.item, viewerZone),
      };
    }
    case "share":
    case "unshare": {
      const resolved = resolveAgendaItem({
        profileId,
        itemId: input.itemId,
        match: input.match,
        timeZone: viewerZone,
      });
      if (!resolved.item) {
        if (resolved.candidates.length > 1) {
          return buildCandidatesOutput(resolved.candidates, viewerZone);
        }
        return { ok: false, error: "Agenda item not found." };
      }
      ensureOwner(profileId, resolved.item);
      const target = resolveProfileIdentifier(input.targetProfile);
      if (target.id === resolved.item.profile_id) {
        return {
          ok: false,
          error: "You cannot share an item with its owner.",
        };
      }
      if (input.action === "share") {
        shareAgendaItem(resolved.item, target.id);
      } else {
        unshareAgendaItem(resolved.item, target.id);
      }
      const row = getAgendaItemById(profileId, resolved.item.id);
      if (!row) {
        return { ok: false, error: "Agenda item not found." };
      }
      return {
        ok: true,
        action: input.action,
        message:
          input.action === "share"
            ? `Agenda item shared with ${target.name}.`
            : `Agenda item is no longer shared with ${target.name}.`,
        item: rowToAgendaItem(row, viewerZone),
      };
    }
    case "list": {
      const range = computeRange(input.range, viewerZone);
      const rows = listAgendaRows({
        profileId,
        rangeStartUtc: range.startUtc,
        rangeEndUtc: range.endUtc,
        includeOverlaps: input.includeOverlaps ?? true,
      });
      const items = rows.map((row) => rowToAgendaItem(row, viewerZone));
      return {
        ok: true,
        action: "list",
        rangeLabel: range.rangeLabel,
        timezone: range.timeZone,
        items,
      };
    }
    default:
      return { ok: false, error: "Unsupported agenda action." };
  }
}

export const __test__ = {
  computeRange,
  zonedDateTimeToUtc,
  formatDateInZone,
  formatTimeInZone,
  parseDateParts,
  parseTimeParts,
};
