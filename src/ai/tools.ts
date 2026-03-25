import { jsonSchema, tool as createTool } from "ai";
import { z } from "zod";
import { getWeatherForLocation, getWeatherForecastForLocation } from "@/ai/weather";
import { getTimezones } from "@/ai/timezones";
import { listProfileListOverviews, runListAction } from "@/server/lists";
import { runNoteAction } from "@/server/notes";
import { runAgendaAction } from "@/server/agenda";
import { upsertPendingMemory } from "@/server/pending-memory";
import { getUrlSummary, type UrlSummaryLength } from "@/ai/url-summary";
import type { CurrentDateTimeToolOutput } from "@/ai/current-date-time";
import { WEATHER_HOURLY_FORECAST_HOURS } from "@/lib/weather-constants";
import { createToolBundle, defineToolEntry, type ToolBundle } from "@/ai/tool-bundle";

function createStrictTool(config: any) {
  return createTool({
    strict: true,
    ...config,
  });
}

function createStrictObjectJsonSchema(properties: any) {
  return jsonSchema({
    type: "object",
    additionalProperties: false,
    properties: properties as any,
    required: Object.keys(properties),
  });
}

function nullableStringJsonProperty(description: string, extra: Record<string, unknown> = {}): any {
  return {
    type: ["string", "null"] as const,
    description,
    default: null,
    ...extra,
  };
}

function nullableIntegerJsonProperty(description: string, extra: Record<string, unknown> = {}): any {
  return {
    type: ["integer", "null"] as const,
    description,
    default: null,
    ...extra,
  };
}

function nullableBooleanJsonProperty(description: string, extra: Record<string, unknown> = {}): any {
  return {
    type: ["boolean", "null"] as const,
    description,
    default: null,
    ...extra,
  };
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

const AgendaMatchJsonSchema: any = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: nullableStringJsonProperty("Agenda item description to match."),
    date: nullableStringJsonProperty("Agenda item date to match."),
    time: nullableStringJsonProperty("Agenda item time to match."),
  },
  required: ["description", "date", "time"],
};

const AgendaPatchJsonSchema: any = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: nullableStringJsonProperty("Updated agenda description."),
    date: nullableStringJsonProperty("Updated agenda date."),
    time: nullableStringJsonProperty("Updated agenda time."),
    duration_minutes: nullableIntegerJsonProperty("Updated duration in minutes.", {
      minimum: 1,
      maximum: 24 * 60,
    }),
    timezone: nullableStringJsonProperty("Updated agenda timezone."),
  },
  required: ["description", "date", "time", "duration_minutes", "timezone"],
};

const AgendaRangeJsonSchema: any = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["today", "tomorrow", "this_week", "this_month", "next_n_days"],
      description: "Range kind to list agenda items for.",
    },
    days: nullableIntegerJsonProperty("Number of days when kind=next_n_days.", {
      minimum: 1,
      maximum: 365,
    }),
    timezone: nullableStringJsonProperty("Optional timezone for the range."),
    week_start: {
      type: ["string", "null"] as const,
      enum: ["monday", "sunday", null],
      description: "Week start day for week-based ranges.",
      default: null,
    },
  },
  required: ["kind", "days", "timezone", "week_start"],
};

const DisplayAgendaToolJsonSchema = createStrictObjectJsonSchema({
  action: {
    type: "string",
    enum: ["create", "update", "delete", "share", "unshare", "list"],
    description: "Agenda operation to perform.",
  },
  description: nullableStringJsonProperty("Agenda item description for create operations."),
  date: nullableStringJsonProperty("Agenda date for create operations."),
  time: nullableStringJsonProperty("Agenda time for create operations."),
  duration_minutes: nullableIntegerJsonProperty("Agenda duration in minutes for create operations.", {
    minimum: 1,
    maximum: 24 * 60,
  }),
  timezone: nullableStringJsonProperty("Optional agenda timezone."),
  item_id: nullableStringJsonProperty("Agenda item id for update, delete, share, or unshare."),
  match: { anyOf: [AgendaMatchJsonSchema, { type: "null" }], default: null },
  patch: { anyOf: [AgendaPatchJsonSchema, { type: "null" }], default: null },
  target_profile: nullableStringJsonProperty("Profile to share or unshare an agenda item with."),
  range: { anyOf: [AgendaRangeJsonSchema, { type: "null" }], default: null },
  include_overlaps: nullableBooleanJsonProperty(
    "Whether overlapping items should be included for list operations.",
  ),
});

const AgendaRangeSchema = z
  .object({
    kind: z.enum(["today", "tomorrow", "this_week", "this_month", "next_n_days"]),
    days: z.number().int().min(1).max(365).optional(),
    timezone: z.string().optional(),
    week_start: z.enum(["monday", "sunday"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "next_n_days" && typeof value.days !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "range.days is required when kind=next_n_days",
        path: ["days"],
      });
    }
  });

const AgendaMatchSchema = z
  .object({
    description: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.description && !value.date && !value.time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "match requires at least one field",
      });
    }
  });

const AgendaPatchSchema = z
  .object({
    description: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
    duration_minutes: z.number().int().min(1).max(24 * 60).optional(),
    timezone: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.description &&
      !value.date &&
      !value.time &&
      typeof value.duration_minutes !== "number" &&
      !value.timezone
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "patch requires at least one field",
      });
    }
  });

const AgendaCreateInputSchema = z
  .object({
    action: z.literal("create"),
    description: z.string().min(1),
    date: z.string().min(1),
    time: z.string().min(1),
    duration_minutes: z.number().int().min(1).max(24 * 60),
    timezone: z.string().optional(),
  })
  .strict();

const AgendaUpdateInputSchema = z
  .object({
    action: z.literal("update"),
    item_id: z.string().min(1).optional(),
    match: AgendaMatchSchema.optional(),
    patch: AgendaPatchSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.item_id && !value.match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "update requires item_id or match",
      });
    }
  });

const AgendaDeleteInputSchema = z
  .object({
    action: z.literal("delete"),
    item_id: z.string().min(1).optional(),
    match: AgendaMatchSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.item_id && !value.match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "delete requires item_id or match",
      });
    }
  });

const AgendaShareBaseSchema = z
  .object({
    item_id: z.string().min(1).optional(),
    match: AgendaMatchSchema.optional(),
    target_profile: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.item_id && !value.match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "share/unshare requires item_id or match",
      });
    }
  });

const AgendaShareInputSchema = AgendaShareBaseSchema.extend({
  action: z.literal("share"),
}).strict();

const AgendaUnshareInputSchema = AgendaShareBaseSchema.extend({
  action: z.literal("unshare"),
}).strict();

const AgendaListInputSchema = z
  .object({
    action: z.literal("list"),
    range: AgendaRangeSchema,
    include_overlaps: z.boolean().optional(),
  })
  .strict();

export const DisplayAgendaInputSchema = z.discriminatedUnion("action", [
  AgendaCreateInputSchema,
  AgendaUpdateInputSchema,
  AgendaDeleteInputSchema,
  AgendaShareInputSchema,
  AgendaUnshareInputSchema,
  AgendaListInputSchema,
]);

export type DisplayAgendaInput = z.infer<typeof DisplayAgendaInputSchema>;

function pickFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function sanitizeAgendaMatch(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const description = pickFirstString(record, [
    "description",
    "beschrijving",
    "omschrijving",
    "title",
    "titel",
    "subject",
    "onderwerp",
    "name",
    "content",
    "summary",
  ]);
  const date = typeof record.date === "string" && record.date.trim() ? record.date.trim() : undefined;
  const time = typeof record.time === "string" && record.time.trim() ? record.time.trim() : undefined;
  if (!description && !date && !time) return undefined;
  return {
    ...(description ? { description } : {}),
    ...(date ? { date } : {}),
    ...(time ? { time } : {}),
  };
}

export function repairDisplayAgendaInput(input: unknown): DisplayAgendaInput | null {
  if (typeof input === "string") {
    try {
      return repairDisplayAgendaInput(JSON.parse(input));
    } catch {
      return null;
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action.trim() : "";
  if (!action) return null;

  if (action === "create") {
    const durationMinutes =
      typeof record.duration_minutes === "number"
        ? record.duration_minutes
        : Number.isFinite(Number(record.duration_minutes))
          ? Number(record.duration_minutes)
          : undefined;
    const timezone =
      typeof record.timezone === "string" && record.timezone.trim()
        ? record.timezone.trim()
        : undefined;
    const repaired = {
      action: "create" as const,
      description: pickFirstString(record, [
        "description",
        "beschrijving",
        "omschrijving",
        "title",
        "titel",
        "subject",
        "onderwerp",
        "name",
        "content",
        "summary",
      ]),
      date: typeof record.date === "string" ? record.date.trim() : "",
      time: typeof record.time === "string" ? record.time.trim() : "",
      ...(typeof durationMinutes === "number"
        ? { duration_minutes: durationMinutes }
        : {}),
      ...(timezone ? { timezone } : {}),
    };
    const parsed = DisplayAgendaInputSchema.safeParse(repaired);
    return parsed.success ? parsed.data : null;
  }

  if (action === "update") {
    const repaired = {
      action: "update" as const,
      item_id:
        typeof record.item_id === "string" && record.item_id.trim()
          ? record.item_id.trim()
          : undefined,
      match: sanitizeAgendaMatch(record.match),
      patch:
        record.patch && typeof record.patch === "object" && !Array.isArray(record.patch)
          ? {
              ...(sanitizeAgendaMatch(record.patch)
                ? sanitizeAgendaMatch(record.patch)
                : {}),
              ...(typeof (record.patch as Record<string, unknown>).duration_minutes === "number"
                ? {
                    duration_minutes: (record.patch as Record<string, unknown>).duration_minutes,
                  }
                : Number.isFinite(
                      Number((record.patch as Record<string, unknown>).duration_minutes),
                    )
                  ? {
                      duration_minutes: Number(
                        (record.patch as Record<string, unknown>).duration_minutes,
                      ),
                    }
                  : {}),
              ...(typeof (record.patch as Record<string, unknown>).timezone === "string" &&
              String((record.patch as Record<string, unknown>).timezone).trim()
                ? {
                    timezone: String(
                      (record.patch as Record<string, unknown>).timezone,
                    ).trim(),
                  }
                : {}),
            }
          : undefined,
    };
    const parsed = DisplayAgendaInputSchema.safeParse(repaired);
    return parsed.success ? parsed.data : null;
  }

  if (action === "delete") {
    const repaired = {
      action: "delete" as const,
      item_id:
        typeof record.item_id === "string" && record.item_id.trim()
          ? record.item_id.trim()
          : undefined,
      match: sanitizeAgendaMatch(record.match),
    };
    const parsed = DisplayAgendaInputSchema.safeParse(repaired);
    return parsed.success ? parsed.data : null;
  }

  if (action === "share" || action === "unshare") {
    const repaired = {
      action,
      item_id:
        typeof record.item_id === "string" && record.item_id.trim()
          ? record.item_id.trim()
          : undefined,
      match: sanitizeAgendaMatch(record.match),
      target_profile: pickFirstString(record, ["target_profile"]),
    };
    const parsed = DisplayAgendaInputSchema.safeParse(repaired);
    return parsed.success ? parsed.data : null;
  }

  if (action === "list") {
    const range =
      record.range && typeof record.range === "object" && !Array.isArray(record.range)
        ? (() => {
            const rangeRecord = record.range as Record<string, unknown>;
            const kind =
              typeof rangeRecord.kind === "string" ? String(rangeRecord.kind).trim() : undefined;
            const days =
              typeof rangeRecord.days === "number"
                ? rangeRecord.days
                : Number.isFinite(Number(rangeRecord.days))
                  ? Number(rangeRecord.days)
                  : undefined;
            const timezone =
              typeof rangeRecord.timezone === "string" && String(rangeRecord.timezone).trim()
                ? String(rangeRecord.timezone).trim()
                : undefined;
            const weekStart =
              typeof rangeRecord.week_start === "string"
                ? String(rangeRecord.week_start).trim()
                : undefined;

            return {
              ...(kind ? { kind } : {}),
              ...(typeof days === "number" ? { days } : {}),
              ...(timezone ? { timezone } : {}),
              ...(weekStart ? { week_start: weekStart } : {}),
            };
          })()
        : undefined;

    const repaired = {
      action: "list" as const,
      range,
      include_overlaps:
        typeof record.include_overlaps === "boolean" ? record.include_overlaps : undefined,
    };
    const parsed = DisplayAgendaInputSchema.safeParse(repaired);
    return parsed.success ? parsed.data : null;
  }

  return null;
}

export const displayWeather = createStrictTool({
  description:
    `Display the current weather and the next ${WEATHER_HOURLY_FORECAST_HOURS} hours forecast for a location.`,
  inputSchema: z.object({
    location: z.string().describe("The location to get the weather for"),
  }).strict(),
  execute: async ({ location }: any) => {
    return getWeatherForLocation({
      location,
      forecastHours: WEATHER_HOURLY_FORECAST_HOURS,
    });
  },
});

export const displayWeatherForecast = createStrictTool({
  description: "Display a multi-day weather forecast for a location.",
  inputSchema: z.object({
    location: z.string().describe("The location to get the forecast for"),
  }).strict(),
  execute: async ({ location }: any) => {
    return getWeatherForecastForLocation({ location, forecastDays: 7 });
  },
});

export const displayMemoryAnswer = createStrictTool({
  description:
    "Display an answer that was derived from saved memory in a special memory card.",
  inputSchema: z.object({
    answer: z.string().describe("The assistant's final answer text"),
  }).strict(),
  execute: async ({ answer }: any) => {
    return { answer };
  },
});

export const displayTimezones = createStrictTool({
  description:
    "Display current times across multiple timezones, optionally converted from a reference time.",
  inputSchema: createStrictObjectJsonSchema({
    zones: {
      type: "array",
      items: { type: "string" },
      description: "City names or IANA timezone ids to include.",
      default: [],
    },
    reference_time: nullableStringJsonProperty(
      "Optional reference time like '09:30' or '2026-01-16 09:30'.",
    ),
    reference_zone: nullableStringJsonProperty(
      "Timezone or city name for the reference time.",
    ),
  }),
  execute: async ({ zones, reference_time, reference_zone }: any) => {
    return getTimezones({
      zones: Array.isArray(zones)
        ? zones.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [],
      referenceTime: normalizeOptionalString(reference_time),
      referenceZone: normalizeOptionalString(reference_zone),
    });
  },
});

export function createTools(input: {
  chatId?: string;
  profileId: string;
  memoryEnabled?: boolean;
  isTemporary?: boolean;
  viewerTimeZone?: string;
  toolContext?: {
    lastUserText?: string;
    previousUserText?: string;
  };
  model?: import("ai").LanguageModel;
  supportsTemperature?: boolean;
}): ToolBundle {
  const memoryEnabled = Boolean(input.memoryEnabled);
  const isTemporary = Boolean(input.isTemporary);

  const displayCurrentDateTime = createStrictTool({
    description:
      "Display the current date and time (including ISO date) for a single timezone. Defaults to the viewer timezone when available.",
    inputSchema: createStrictObjectJsonSchema({
      zone: nullableStringJsonProperty(
        "Optional city name or IANA timezone id (e.g. 'Europe/Amsterdam').",
      ),
    }),
    execute: async ({ zone }: any): Promise<CurrentDateTimeToolOutput> => {
      const requestedZone = String(zone ?? "").trim();
      const effectiveZone = requestedZone || input.viewerTimeZone || "UTC";

      const nowUtcISO = new Date().toISOString();
      const output = await getTimezones({ zones: [effectiveZone] });
      const entry =
        output.entries.find((e) => e.isReference) ?? output.entries[0];
      if (!entry) {
        throw new Error("No timezone could be resolved.");
      }

      const timePart = String(entry.localDateTimeISO.split("T")[1] ?? "").trim();
      return {
        nowUtcISO,
        zone: {
          label: entry.label,
          timeZone: entry.timeZone,
          offset: entry.offset,
        },
        local: {
          dateISO: entry.localDateISO,
          time24: timePart || entry.localTime,
          dateTimeISO: entry.localDateTimeISO,
          dateLabel: entry.dateLabel,
        },
      };
    },
  });

  const displayMemoryPrompt = createStrictTool({
    description:
      "Ask the user to confirm saving a memory. This tool does not save automatically; it prepares a pending memory item and shows a confirmation card.",
    inputSchema: z.object({
      content: z
        .string()
        .describe("A self-contained memory candidate to propose saving."),
    }).strict(),
    execute: async ({ content }: any) => {
      if (isTemporary) {
        throw new Error("Temporary chats do not support memory saves.");
      }
      if (!memoryEnabled) {
        throw new Error("Memory is currently off for this profile.");
      }
      const chatId = String(input.chatId ?? "").trim();
      if (!chatId) {
        throw new Error("Missing chat id for pending memory.");
      }
      const pending = upsertPendingMemory({
        chatId,
        profileId: input.profileId,
        content,
      });
      return { content: pending.content };
    },
  });

  const displayNotes = createStrictTool({
    description: "Create, delete, or show quick notes for the active profile.",
    inputSchema: createStrictObjectJsonSchema({
      action: {
        type: "string",
        enum: ["show", "create", "delete"],
      },
      content: {
        type: "string",
        description: "Note content for create actions.",
        default: "",
      },
      note_id: {
        type: "string",
        description: "Note id to delete; use empty string if not provided.",
        default: "",
      },
      note_index: nullableIntegerJsonProperty(
        "1-based index of the note to delete (from the latest list).",
      ),
      limit: nullableIntegerJsonProperty("How many notes to show (1-20).", {
        minimum: 1,
        maximum: 20,
      }),
    }),
    execute: async (inputData: any) => {
      return runNoteAction(input.profileId, {
        action: inputData.action,
        content: typeof inputData.content === "string" ? inputData.content : "",
        noteId: typeof inputData.note_id === "string" ? inputData.note_id : "",
        noteIndex: normalizeOptionalInteger(inputData.note_index),
        limit: normalizeOptionalInteger(inputData.limit),
      });
    },
  });
  const displayList = createStrictTool({
    description:
      "Create, update, delete, share, or show a to-do or shopping list for the active profile. Always return the updated list for display.",
    inputSchema: createStrictObjectJsonSchema({
      action: {
        type: "string",
        enum: [
          "show",
          "create",
          "add_items",
          "toggle_items",
          "remove_items",
          "clear_completed",
          "rename_list",
          "delete_list",
          "share_list",
          "unshare_list",
        ],
      },
      list_name: {
        type: "string",
        description: "Optional list name; use empty string if not needed.",
        default: "",
      },
      list_id: {
        type: "string",
        description: "Optional list id; use empty string if not needed.",
        default: "",
      },
      list_owner: {
        type: "string",
        description:
          "Optional profile name or id of the list owner when disambiguating shared lists.",
        default: "",
      },
      list_kind: {
        type: ["string", "null"] as const,
        enum: ["todo", "grocery", null],
        description: "Optional list type hint.",
        default: null,
      },
      items: {
        type: "array",
        items: { type: "string" },
        description: "Item texts to add, toggle, or remove.",
        default: [],
      },
      item_ids: {
        type: "array",
        items: { type: "string" },
        description: "Item ids to toggle or remove.",
        default: [],
      },
      new_name: {
        type: "string",
        description: "New list name when renaming; otherwise empty.",
        default: "",
      },
      target_profile: {
        type: "string",
        description: "Profile name or id to share or unshare with.",
        default: "",
      },
    }),
    execute: async (inputData: any) => {
      try {
        return runListAction(input.profileId, {
          action: inputData.action,
          listId: typeof inputData.list_id === "string" ? inputData.list_id : "",
          listName: typeof inputData.list_name === "string" ? inputData.list_name : "",
          listKind:
            inputData.list_kind === "todo" || inputData.list_kind === "grocery"
              ? inputData.list_kind
              : undefined,
          listOwner: typeof inputData.list_owner === "string" ? inputData.list_owner : "",
          items: Array.isArray(inputData.items)
            ? inputData.items.filter(
                (value: unknown): value is string =>
                  typeof value === "string" && value.trim().length > 0,
              )
            : [],
          itemIds: Array.isArray(inputData.item_ids)
            ? inputData.item_ids.filter(
                (value: unknown): value is string =>
                  typeof value === "string" && value.trim().length > 0,
              )
            : [],
          newName: typeof inputData.new_name === "string" ? inputData.new_name : "",
          targetProfile:
            typeof inputData.target_profile === "string" ? inputData.target_profile : "",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown list error.";
        throw new Error(`List error: ${message}`);
      }
    },
  });
  const displayListsOverview = createStrictTool({
    description:
      "Display an overview of all accessible to-do or shopping lists for the active profile.",
    inputSchema: z.object({}).strict(),
    execute: async () => {
      const lists = listProfileListOverviews(input.profileId);
      const counts = lists.reduce(
        (acc, list) => {
          if (list.scope === "owned") acc.owned += 1;
          if (list.scope === "shared") acc.shared += 1;
          acc.total += 1;
          return acc;
        },
        { owned: 0, shared: 0, total: 0 }
      );
      return { lists, counts };
    },
  });
	  const displayAgenda = createStrictTool({
	    description:
	      "Create, update, delete, share, or list agenda items for the active profile.",
	    inputSchema: DisplayAgendaToolJsonSchema,
      inputExamples: [
        {
          input: {
            action: "create",
            description: "Dentist appointment",
            date: "2026-03-16",
            time: "09:30",
            duration_minutes: 30,
            timezone: "Europe/Amsterdam",
            item_id: null,
            match: null,
            patch: null,
            target_profile: null,
            range: null,
            include_overlaps: null,
          },
        },
        {
          input: {
            action: "update",
            description: null,
            date: null,
            time: null,
            duration_minutes: null,
            timezone: null,
            item_id: null,
            match: {
              description: "Dentist appointment",
              date: "2026-03-16",
              time: null,
            },
            patch: {
              description: null,
              date: null,
              time: "10:00",
              duration_minutes: null,
              timezone: null,
            },
            target_profile: null,
            range: null,
            include_overlaps: null,
          },
        },
        {
          input: {
            action: "delete",
            description: null,
            date: null,
            time: null,
            duration_minutes: null,
            timezone: null,
            item_id: "agenda_123",
            match: null,
            patch: null,
            target_profile: null,
            range: null,
            include_overlaps: null,
          },
        },
        {
          input: {
            action: "share",
            description: null,
            date: null,
            time: null,
            duration_minutes: null,
            timezone: null,
            item_id: "agenda_123",
            match: null,
            patch: null,
            target_profile: "Work",
            range: null,
            include_overlaps: null,
          },
        },
        {
          input: {
            action: "list",
            description: null,
            date: null,
            time: null,
            duration_minutes: null,
            timezone: null,
            item_id: null,
            match: null,
            patch: null,
            target_profile: null,
            range: {
              kind: "next_n_days",
              days: 7,
              timezone: null,
              week_start: null,
            },
            include_overlaps: true,
          },
        },
      ],
	    execute: async (inputData: any) => {
        const canonicalInput =
          repairDisplayAgendaInput(inputData) ?? DisplayAgendaInputSchema.parse(inputData);
	      const action = canonicalInput.action;
	      if (isTemporary && action !== "list") {
	        throw new Error(
	          "Temporary chats do not save agenda items. Turn off Temp to manage your agenda.",
	        );
	      }
	      if (action === "create") {
	        return runAgendaAction(input.profileId, {
	          action,
	          description: canonicalInput.description,
	          date: canonicalInput.date,
	          time: canonicalInput.time,
	          durationMinutes: canonicalInput.duration_minutes,
	          timezone: canonicalInput.timezone,
	        }, { viewerTimeZone: input.viewerTimeZone });
	      }
	      if (action === "update") {
	        return runAgendaAction(input.profileId, {
	          action,
	          itemId: canonicalInput.item_id || undefined,
	          match: canonicalInput.match
	            ? {
	                description: canonicalInput.match.description || undefined,
	                date: canonicalInput.match.date,
	                time: canonicalInput.match.time,
	              }
	            : undefined,
	          patch: {
	            description: canonicalInput.patch.description || undefined,
	            date: canonicalInput.patch?.date,
	            time: canonicalInput.patch?.time,
	            durationMinutes: canonicalInput.patch?.duration_minutes,
	            timezone: canonicalInput.patch?.timezone,
	          },
	        }, { viewerTimeZone: input.viewerTimeZone });
	      }
      if (action === "delete") {
        return runAgendaAction(input.profileId, {
          action,
          itemId: canonicalInput.item_id || undefined,
          match: canonicalInput.match,
        }, { viewerTimeZone: input.viewerTimeZone });
      }
      if (action === "share" || action === "unshare") {
        return runAgendaAction(input.profileId, {
          action,
          itemId: canonicalInput.item_id || undefined,
          match: canonicalInput.match,
          targetProfile: canonicalInput.target_profile,
        }, { viewerTimeZone: input.viewerTimeZone });
      }
      if (action === "list") {
        if (!canonicalInput.range) {
          throw new Error("Range is required for list actions.");
        }
        const range =
          canonicalInput.range.kind === "next_n_days"
            ? (() => {
                if (typeof canonicalInput.range.days !== "number") {
                  throw new Error("Range days is required when kind=next_n_days.");
                }
                return {
                  kind: "next_n_days" as const,
                  days: canonicalInput.range.days,
                  timezone: canonicalInput.range.timezone,
                  weekStart: canonicalInput.range.week_start,
                };
              })()
            : {
                kind: canonicalInput.range.kind,
                timezone: canonicalInput.range.timezone,
                weekStart: canonicalInput.range.week_start,
              };
	        return runAgendaAction(input.profileId, {
	          action,
	          range,
          includeOverlaps: canonicalInput.include_overlaps,
        }, { viewerTimeZone: input.viewerTimeZone });
      }
      throw new Error("Unsupported agenda action.");
    },
  });

  const displayUrlSummary = input.model
    ? createStrictTool({
        description:
          "Fetch and summarize the content of a web URL. Returns a structured summary with title, key points, and metadata. Useful when the user asks to summarize a link or webpage.",
        inputSchema: createStrictObjectJsonSchema({
          url: {
            type: "string",
            description: "The URL to fetch and summarize. Must be a valid http or https URL.",
          },
          length: {
            type: "string",
            enum: ["short", "medium", "long"],
            description:
              "Desired summary length: short (1 paragraph), medium (2 paragraphs), or long (3 paragraphs).",
            default: "medium",
          },
          focus: nullableStringJsonProperty(
            "Optional topic to focus on in the summary. If the content doesn't cover this topic, the summary will say so.",
          ),
          language: {
            type: "string",
            description:
              "Language code for the output summary (e.g., 'en', 'es', 'fr'). Use 'auto' to match the source language.",
            default: "auto",
          },
        }),
        execute: async (inputData: any) => {
          return getUrlSummary({
            url: inputData.url,
            length: inputData.length as UrlSummaryLength,
            focus: normalizeOptionalString(inputData.focus),
            language: typeof inputData.language === "string" ? inputData.language : "auto",
            model: input.model!,
            supportsTemperature: input.supportsTemperature,
          });
        },
      })
    : null;

  return createToolBundle({
    enabled: true,
    entries: [
      defineToolEntry({
        name: "displayWeather",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayWeather,
      }),
      defineToolEntry({
        name: "displayWeatherForecast",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayWeatherForecast,
      }),
      defineToolEntry({
        name: "displayMemoryPrompt",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayMemoryPrompt,
      }),
      defineToolEntry({
        name: "displayMemoryAnswer",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayMemoryAnswer,
      }),
      defineToolEntry({
        name: "displayTimezones",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayTimezones,
      }),
      defineToolEntry({
        name: "displayCurrentDateTime",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayCurrentDateTime,
      }),
      defineToolEntry({
        name: "displayNotes",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayNotes,
      }),
      defineToolEntry({
        name: "displayList",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayList,
      }),
      defineToolEntry({
        name: "displayListsOverview",
        metadata: { group: "display", risk: "safe", strict: true },
        tool: displayListsOverview,
      }),
      defineToolEntry({
        name: "displayAgenda",
        metadata: {
          group: "display",
          risk: "safe",
          strict: true,
          inputExamples: [
            {
              input: {
                action: "create",
                description: "Dentist appointment",
                date: "2026-03-16",
                time: "09:30",
                duration_minutes: 30,
                timezone: null,
                item_id: null,
                match: null,
                patch: null,
                target_profile: null,
                range: null,
                include_overlaps: null,
              },
            },
          ],
          repairStrategy: "displayAgenda",
        },
        tool: displayAgenda,
      }),
      ...(displayUrlSummary
        ? [
            defineToolEntry({
              name: "displayUrlSummary",
              metadata: { group: "display", risk: "safe", strict: true },
              tool: displayUrlSummary,
            }),
            defineToolEntry({
              name: "summarizeURL",
              metadata: { group: "display", risk: "safe", strict: true },
              tool: displayUrlSummary,
            }),
          ]
        : []),
    ],
  });
}
