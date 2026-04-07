import { nanoid } from "nanoid";
import type { AgendaItem, AgendaToolOutput } from "@/domain/agenda/types";
import {
  addDays,
  computeRange,
  ensureDescription,
  ensureDurationMinutes,
  formatDateInZone,
  formatTimeInZone,
  getSystemTimeZone,
  normalizeSpaces,
  parseDateParts,
  parseTimeParts,
  resolveTimeZone,
  type AgendaRange,
  zonedDateTimeToUtc,
} from "@/server/agenda-domain";
import {
  sqliteAgendaRepository,
  type AgendaRepository,
  type StoredAgendaItemRecord,
  type StoredAgendaTimestampFilter,
} from "@/server/agenda-repository";
import { listProfiles } from "@/server/profiles";

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

export type AgendaService = {
  listProfileAgendaItems(profileId: string): AgendaItem[];
  runAgendaAction(
    profileId: string,
    input: AgendaActionInput,
    options?: { viewerTimeZone?: string },
  ): AgendaToolOutput;
};

function resolveProfileIdentifier(input: string) {
  const normalized = normalizeSpaces(input);
  if (!normalized) throw new Error("Target profile is required.");
  const profiles = listProfiles();
  const byId = profiles.find((profile) => profile.id === normalized);
  if (byId) return byId;
  const byName = profiles.find(
    (profile) => profile.name.toLowerCase() === normalized.toLowerCase(),
  );
  if (byName) return byName;
  throw new Error(`Profile not found: "${normalized}".`);
}

function recordToAgendaItem(
  record: StoredAgendaItemRecord,
  viewerTimeZone: string,
): AgendaItem {
  const start = new Date(record.startAt);
  const end = new Date(start.getTime() + record.durationMinutes * 60_000);
  const itemTimeZone = resolveTimeZone(record.timezone);
  const viewerZone = resolveTimeZone(viewerTimeZone);

  return {
    id: record.id,
    profileId: record.profileId,
    description: record.description,
    startAt: record.startAt,
    endAt: end.toISOString(),
    durationMinutes: record.durationMinutes,
    timezone: itemTimeZone,
    ownerProfileId: record.profileId,
    ownerProfileName: record.ownerName,
    scope: record.scope,
    sharedWithCount: record.sharedWithCount,
    localDate: formatDateInZone(start, itemTimeZone),
    localTime: formatTimeInZone(start, itemTimeZone),
    viewerLocalDate: formatDateInZone(start, viewerZone),
    viewerLocalTime: formatTimeInZone(start, viewerZone),
  };
}

export function createAgendaService(repository: AgendaRepository): AgendaService {
  function listProfileAgendaItems(profileId: string) {
    const viewerZone = getSystemTimeZone();
    return repository
      .listAccessibleAgendaRecords(profileId)
      .map((record) => recordToAgendaItem(record, viewerZone));
  }

  function findAgendaCandidates(input: {
    profileId: string;
    match: { description?: string; date?: string; time?: string };
    timeZone?: string;
  }) {
    const descriptionQuery = normalizeSpaces(String(input.match.description ?? ""));
    const startAtFilters: StoredAgendaTimestampFilter[] = [];

    if (input.match.date) {
      const date = parseDateParts(input.match.date);
      const timeZone = resolveTimeZone(input.timeZone);
      startAtFilters.push({
        operator: ">=",
        value: zonedDateTimeToUtc(date, { hour: 0, minute: 0 }, timeZone),
      });
      startAtFilters.push({
        operator: "<",
        value: zonedDateTimeToUtc(addDays(date, 1), { hour: 0, minute: 0 }, timeZone),
      });
    }

    if (input.match.time && input.match.date) {
      const date = parseDateParts(input.match.date);
      const time = parseTimeParts(input.match.time);
      const timeZone = resolveTimeZone(input.timeZone);
      const target = zonedDateTimeToUtc(date, time, timeZone);
      startAtFilters.push({
        operator: ">=",
        value: new Date(target.getTime() - 5 * 60_000),
      });
      startAtFilters.push({
        operator: "<=",
        value: new Date(target.getTime() + 5 * 60_000),
      });
    }

    return repository.findAccessibleAgendaRecords({
      profileId: input.profileId,
      descriptionQuery: descriptionQuery || undefined,
      startAtFilters,
      limit: 10,
    });
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

    return repository.createOwnedAgendaRecord({
      id: nanoid(),
      profileId: input.profileId,
      description,
      startAt: startUtc.toISOString(),
      durationMinutes,
      timezone: timeZone,
      now: new Date().toISOString(),
    });
  }

  function updateAgendaItem(input: {
    item: StoredAgendaItemRecord;
    patch: Partial<{
      description: string;
      date: string;
      time: string;
      durationMinutes: number;
      timezone: string;
    }>;
  }) {
    const currentStart = new Date(input.item.startAt);
    const currentTimeZone = resolveTimeZone(input.item.timezone);
    const nextDescription =
      input.patch.description != null
        ? ensureDescription(input.patch.description)
        : input.item.description;
    const nextDate = input.patch.date ?? formatDateInZone(currentStart, currentTimeZone);
    const nextTime = input.patch.time ?? formatTimeInZone(currentStart, currentTimeZone);
    const nextDuration =
      input.patch.durationMinutes != null
        ? ensureDurationMinutes(input.patch.durationMinutes)
        : input.item.durationMinutes;
    const nextTimeZone =
      input.patch.timezone != null
        ? resolveTimeZone(input.patch.timezone)
        : currentTimeZone;
    const startUtc = zonedDateTimeToUtc(
      parseDateParts(nextDate),
      parseTimeParts(nextTime),
      nextTimeZone,
    );

    repository.updateOwnedAgendaRecord({
      itemId: input.item.id,
      description: nextDescription,
      startAt: startUtc.toISOString(),
      durationMinutes: nextDuration,
      timezone: nextTimeZone,
      updatedAt: new Date().toISOString(),
    });

    return repository.getAccessibleAgendaRecordById(input.item.profileId, input.item.id)!;
  }

  function resolveAgendaItem(input: {
    profileId: string;
    itemId?: string;
    match?: { description?: string; date?: string; time?: string };
    timeZone?: string;
  }) {
    if (input.itemId) {
      const item = repository.getAccessibleAgendaRecordById(input.profileId, input.itemId);
      return { item, candidates: item ? [item] : [] };
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

  function ensureOwner(profileId: string, item: StoredAgendaItemRecord) {
    if (item.profileId !== profileId) {
      throw new Error("Only the item owner can modify it.");
    }
  }

  function buildCandidatesOutput(
    candidates: StoredAgendaItemRecord[],
    viewerTimeZone: string,
  ): AgendaToolOutput {
    return {
      ok: false,
      error: "Multiple matching agenda items found. Please specify which one.",
      candidates: candidates.map((record) => recordToAgendaItem(record, viewerTimeZone)),
    };
  }

  return {
    listProfileAgendaItems,

    runAgendaAction(profileId, input, options) {
      const viewerZone = resolveTimeZone(options?.viewerTimeZone);

      switch (input.action) {
        case "create": {
          const record = createAgendaItem({
            profileId,
            description: input.description,
            date: input.date,
            time: input.time,
            durationMinutes: input.durationMinutes,
            timezone: input.timezone ?? viewerZone,
          });
          return {
            ok: true,
            action: "create",
            message: "Agenda item added.",
            item: recordToAgendaItem(record, viewerZone),
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
          const record = updateAgendaItem({
            item: resolved.item,
            patch: input.patch,
          });
          return {
            ok: true,
            action: "update",
            message: "Agenda item updated.",
            item: recordToAgendaItem(record, viewerZone),
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
          const now = new Date().toISOString();
          repository.markAgendaItemDeleted(resolved.item.id, now, now);
          return {
            ok: true,
            action: "delete",
            message: "Agenda item deleted.",
            item: recordToAgendaItem(resolved.item, viewerZone),
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
          if (target.id === resolved.item.profileId) {
            return {
              ok: false,
              error: "You cannot share an item with its owner.",
            };
          }

          if (input.action === "share") {
            repository.addAgendaItemMember({
              agendaItemId: resolved.item.id,
              profileId: target.id,
              createdAt: new Date().toISOString(),
            });
          } else {
            repository.removeAgendaItemMember(resolved.item.id, target.id);
          }

          const record = repository.getAccessibleAgendaRecordById(profileId, resolved.item.id);
          if (!record) {
            return { ok: false, error: "Agenda item not found." };
          }
          return {
            ok: true,
            action: input.action,
            message:
              input.action === "share"
                ? `Agenda item shared with ${target.name}.`
                : `Agenda item is no longer shared with ${target.name}.`,
            item: recordToAgendaItem(record, viewerZone),
          };
        }

        case "list": {
          const range = computeRange(input.range, viewerZone);
          const items = repository
            .listAccessibleAgendaRecordsInRange({
              profileId,
              rangeStartUtc: range.startUtc,
              rangeEndUtc: range.endUtc,
              includeOverlaps: input.includeOverlaps ?? true,
            })
            .map((record) => recordToAgendaItem(record, viewerZone));

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
    },
  };
}

export const agendaService = createAgendaService(sqliteAgendaRepository);
