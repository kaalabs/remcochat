import { getDb } from "@/server/db";

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

export type StoredAgendaTimestampFilter = {
  operator: ">=" | "<" | "<=";
  value: Date;
};

export type StoredAgendaItemRecord = {
  id: string;
  profileId: string;
  description: string;
  startAt: string;
  durationMinutes: number;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  ownerName?: string;
  sharedWithCount: number;
  scope: "owned" | "shared";
};

export type AgendaRepository = {
  listAccessibleAgendaRecords(profileId: string): StoredAgendaItemRecord[];
  listAccessibleAgendaRecordsInRange(input: {
    profileId: string;
    rangeStartUtc: Date;
    rangeEndUtc: Date;
    includeOverlaps: boolean;
  }): StoredAgendaItemRecord[];
  getAccessibleAgendaRecordById(
    profileId: string,
    itemId: string,
  ): StoredAgendaItemRecord | null;
  findAccessibleAgendaRecords(input: {
    profileId: string;
    descriptionQuery?: string;
    startAtFilters?: StoredAgendaTimestampFilter[];
    limit?: number;
  }): StoredAgendaItemRecord[];
  createOwnedAgendaRecord(input: {
    id: string;
    profileId: string;
    description: string;
    startAt: string;
    durationMinutes: number;
    timezone: string;
    now: string;
  }): StoredAgendaItemRecord;
  updateOwnedAgendaRecord(input: {
    itemId: string;
    description: string;
    startAt: string;
    durationMinutes: number;
    timezone: string;
    updatedAt: string;
  }): void;
  markAgendaItemDeleted(itemId: string, deletedAt: string, updatedAt: string): void;
  addAgendaItemMember(input: {
    agendaItemId: string;
    profileId: string;
    createdAt: string;
  }): void;
  removeAgendaItemMember(agendaItemId: string, profileId: string): void;
};

const ACCESSIBLE_AGENDA_SELECT = `
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
`;

function rowToAgendaRecord(row: AgendaItemRow): StoredAgendaItemRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    description: row.description,
    startAt: row.start_at,
    durationMinutes: row.duration_minutes,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    ownerName: row.owner_name,
    sharedWithCount: row.shared_with_count ?? 0,
    scope: row.scope ?? "owned",
  };
}

function toUnixSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function queryAccessibleAgendaRows(input: {
  profileId: string;
  filters?: string[];
  params?: Array<string | number>;
  orderBy?: string;
  limit?: number;
}) {
  const filters =
    input.filters && input.filters.length > 0
      ? `\n  AND ${input.filters.join("\n  AND ")}`
      : "";
  const limitClause = input.limit != null ? "\nLIMIT ?" : "";
  const rows = getDb()
    .prepare(
      `
        ${ACCESSIBLE_AGENDA_SELECT}
        WHERE agenda_items.deleted_at IS NULL
          AND (
            agenda_items.profile_id = ?
            OR agenda_item_members.profile_id = ?
          )${filters}
        ORDER BY ${input.orderBy ?? "agenda_items.start_at ASC"}${limitClause}
      `,
    )
    .all(
      input.profileId,
      input.profileId,
      input.profileId,
      input.profileId,
      ...(input.params ?? []),
      ...(input.limit != null ? [input.limit] : []),
    ) as AgendaItemRow[];

  return rows;
}

export function createSqliteAgendaRepository(): AgendaRepository {
  return {
    listAccessibleAgendaRecords(profileId) {
      return queryAccessibleAgendaRows({ profileId }).map(rowToAgendaRecord);
    },

    listAccessibleAgendaRecordsInRange(input) {
      const overlapClause = input.includeOverlaps
        ? "CAST(strftime('%s', agenda_items.start_at) AS INTEGER) < ? AND CAST(strftime('%s', agenda_items.start_at, '+' || duration_minutes || ' minutes') AS INTEGER) > ?"
        : "CAST(strftime('%s', agenda_items.start_at) AS INTEGER) >= ? AND CAST(strftime('%s', agenda_items.start_at) AS INTEGER) < ?";
      const params = input.includeOverlaps
        ? [toUnixSeconds(input.rangeEndUtc), toUnixSeconds(input.rangeStartUtc)]
        : [toUnixSeconds(input.rangeStartUtc), toUnixSeconds(input.rangeEndUtc)];
      return queryAccessibleAgendaRows({
        profileId: input.profileId,
        filters: [overlapClause],
        params,
      }).map(rowToAgendaRecord);
    },

    getAccessibleAgendaRecordById(profileId, itemId) {
      const row = queryAccessibleAgendaRows({
        profileId,
        filters: ["agenda_items.id = ?"],
        params: [itemId],
        limit: 1,
      })[0];
      return row ? rowToAgendaRecord(row) : null;
    },

    findAccessibleAgendaRecords(input) {
      const filters: string[] = [];
      const params: Array<string | number> = [];

      if (input.descriptionQuery) {
        filters.push("lower(agenda_items.description) LIKE ?");
        params.push(`%${input.descriptionQuery.toLowerCase()}%`);
      }

      for (const filter of input.startAtFilters ?? []) {
        filters.push(
          `CAST(strftime('%s', agenda_items.start_at) AS INTEGER) ${filter.operator} ?`,
        );
        params.push(toUnixSeconds(filter.value));
      }

      return queryAccessibleAgendaRows({
        profileId: input.profileId,
        filters,
        params,
        limit: input.limit ?? 10,
      }).map(rowToAgendaRecord);
    },

    createOwnedAgendaRecord(input) {
      getDb()
        .prepare(
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
          `,
        )
        .run(
          input.id,
          input.profileId,
          input.description,
          input.startAt,
          input.durationMinutes,
          input.timezone,
          input.now,
          input.now,
        );

      return this.getAccessibleAgendaRecordById(input.profileId, input.id)!;
    },

    updateOwnedAgendaRecord(input) {
      getDb()
        .prepare(
          `
            UPDATE agenda_items
            SET description = ?,
                start_at = ?,
                duration_minutes = ?,
                timezone = ?,
                updated_at = ?
            WHERE id = ?
          `,
        )
        .run(
          input.description,
          input.startAt,
          input.durationMinutes,
          input.timezone,
          input.updatedAt,
          input.itemId,
        );
    },

    markAgendaItemDeleted(itemId, deletedAt, updatedAt) {
      getDb()
        .prepare(`UPDATE agenda_items SET deleted_at = ?, updated_at = ? WHERE id = ?`)
        .run(deletedAt, updatedAt, itemId);
    },

    addAgendaItemMember(input) {
      getDb()
        .prepare(
          `
            INSERT OR IGNORE INTO agenda_item_members (agenda_item_id, profile_id, created_at)
            VALUES (?, ?, ?)
          `,
        )
        .run(input.agendaItemId, input.profileId, input.createdAt);
    },

    removeAgendaItemMember(agendaItemId, profileId) {
      getDb()
        .prepare(
          `DELETE FROM agenda_item_members WHERE agenda_item_id = ? AND profile_id = ?`,
        )
        .run(agendaItemId, profileId);
    },
  };
}

export const sqliteAgendaRepository = createSqliteAgendaRepository();
