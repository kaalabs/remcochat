import { tool as createTool } from "ai";
import { z } from "zod";
import { getWeatherForLocation, getWeatherForecastForLocation } from "@/ai/weather";
import { getTimezones } from "@/ai/timezones";
import { listProfileListOverviews, runListAction } from "@/server/lists";
import { runNoteAction } from "@/server/notes";
import { runAgendaAction } from "@/server/agenda";
import { upsertPendingMemory } from "@/server/pending-memory";

export const displayWeather = createTool({
  description:
    "Display the current weather and a short forecast for a location.",
  inputSchema: z.object({
    location: z.string().describe("The location to get the weather for"),
  }),
  execute: async ({ location }) => {
    return getWeatherForLocation({ location, forecastDays: 3 });
  },
});

export const displayWeatherForecast = createTool({
  description: "Display a multi-day weather forecast for a location.",
  inputSchema: z.object({
    location: z.string().describe("The location to get the forecast for"),
  }),
  execute: async ({ location }) => {
    return getWeatherForecastForLocation({ location, forecastDays: 7 });
  },
});

export const displayMemoryAnswer = createTool({
  description:
    "Display an answer that was derived from saved memory in a special memory card.",
  inputSchema: z.object({
    answer: z.string().describe("The assistant's final answer text"),
  }),
  execute: async ({ answer }) => {
    return { answer };
  },
});

export const displayTimezones = createTool({
  description:
    "Display current times across multiple timezones, optionally converted from a reference time.",
  inputSchema: z.object({
    zones: z
      .array(z.string())
      .describe("City names or IANA timezone ids to include.")
      .default([]),
    reference_time: z
      .string()
      .describe("Optional reference time like '09:30' or '2026-01-16 09:30'.")
      .optional(),
    reference_zone: z
      .string()
      .describe("Timezone or city name for the reference time.")
      .optional(),
  }),
  execute: async ({ zones, reference_time, reference_zone }) => {
    return getTimezones({
      zones,
      referenceTime: reference_time,
      referenceZone: reference_zone,
    });
  },
});

export function createTools(input: {
  chatId?: string;
  profileId: string;
  memoryEnabled?: boolean;
  isTemporary?: boolean;
  viewerTimeZone?: string;
}) {
  const memoryEnabled = Boolean(input.memoryEnabled);
  const isTemporary = Boolean(input.isTemporary);

  const displayMemoryPrompt = createTool({
    description:
      "Ask the user to confirm saving a memory. This tool does not save automatically; it prepares a pending memory item and shows a confirmation card.",
    inputSchema: z.object({
      content: z
        .string()
        .describe("A self-contained memory candidate to propose saving."),
    }),
    execute: async ({ content }) => {
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

  const displayNotes = createTool({
    description: "Create, delete, or show quick notes for the active profile.",
    inputSchema: z.object({
      action: z.enum(["show", "create", "delete"]),
      content: z
        .string()
        .describe("Note content for create actions.")
        .default(""),
      note_id: z
        .string()
        .describe("Note id to delete; use empty string if not provided.")
        .default(""),
      note_index: z
        .number()
        .int()
        .describe("1-based index of the note to delete (from the latest list).")
        .optional(),
      limit: z
        .number()
        .int()
        .describe("How many notes to show (1-20).")
        .optional(),
    }),
    execute: async (inputData) => {
      return runNoteAction(input.profileId, {
        action: inputData.action,
        content: inputData.content,
        noteId: inputData.note_id,
        noteIndex: inputData.note_index,
        limit: inputData.limit,
      });
    },
  });
  const displayList = createTool({
    description:
      "Create, update, delete, share, or show a to-do or shopping list for the active profile. Always return the updated list for display.",
    inputSchema: z.object({
      action: z.enum([
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
      ]),
      list_name: z
        .string()
        .describe("Optional list name; use empty string if not needed.")
        .default(""),
      list_id: z
        .string()
        .describe("Optional list id; use empty string if not needed.")
        .default(""),
      list_owner: z
        .string()
        .describe(
          "Optional profile name or id of the list owner when disambiguating shared lists."
        )
        .default(""),
      list_kind: z
        .enum(["todo", "grocery"])
        .describe("Optional list type hint.")
        .optional(),
      items: z
        .array(z.string())
        .describe("Item texts to add, toggle, or remove.")
        .default([]),
      item_ids: z
        .array(z.string())
        .describe("Item ids to toggle or remove.")
        .default([]),
      new_name: z
        .string()
        .describe("New list name when renaming; otherwise empty.")
        .default(""),
      target_profile: z
        .string()
        .describe("Profile name or id to share or unshare with.")
        .default(""),
    }),
    execute: async (inputData) => {
      return runListAction(input.profileId, {
        action: inputData.action,
        listId: inputData.list_id,
        listName: inputData.list_name,
        listKind: inputData.list_kind,
        listOwner: inputData.list_owner,
        items: inputData.items,
        itemIds: inputData.item_ids,
        newName: inputData.new_name,
        targetProfile: inputData.target_profile,
      });
    },
  });
  const displayListsOverview = createTool({
    description:
      "Display an overview of all accessible to-do or shopping lists for the active profile.",
    inputSchema: z.object({}),
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
  const displayAgenda = createTool({
    description:
      "Create, update, delete, share, or list agenda items for the active profile.",
    inputSchema: z.object({
      action: z.enum([
        "create",
        "update",
        "delete",
        "share",
        "unshare",
        "list",
      ]),
      description: z
        .string()
        .describe("Item description for create actions.")
        .default(""),
      date: z
        .string()
        .describe("YYYY-MM-DD date for create/update actions.")
        .default(""),
      time: z
        .string()
        .describe("HH:MM 24h time for create/update actions.")
        .default(""),
      duration_minutes: z
        .number()
        .int()
        .describe("Duration in minutes for create/update actions.")
        .optional(),
      timezone: z
        .string()
        .describe("Optional IANA timezone for create/update actions.")
        .optional(),
      item_id: z
        .string()
        .describe("Optional agenda item id for update/delete/share actions.")
        .default(""),
      match: z
        .object({
          description: z.string().optional(),
          date: z.string().optional(),
          time: z.string().optional(),
        })
        .describe("Best-effort match fields when item_id is unknown.")
        .optional(),
      patch: z
        .object({
          description: z.string().optional(),
          date: z.string().optional(),
          time: z.string().optional(),
          duration_minutes: z.number().int().optional(),
          timezone: z.string().optional(),
        })
        .describe("Fields to update for update actions.")
        .optional(),
      target_profile: z
        .string()
        .describe("Profile name or id to share or unshare with.")
        .default(""),
      range: z
        .object({
          kind: z.enum([
            "today",
            "tomorrow",
            "this_week",
            "this_month",
            "next_n_days",
          ]),
          days: z.number().int().optional(),
          timezone: z.string().optional(),
          week_start: z.enum(["monday", "sunday"]).optional(),
        })
        .describe("List range definition for list actions.")
        .optional(),
      include_overlaps: z
        .boolean()
        .describe("Include items that overlap the range window.")
        .optional(),
    }),
    execute: async (inputData) => {
      const action = inputData.action;
      if (action === "create") {
        return runAgendaAction(input.profileId, {
          action,
          description: inputData.description,
          date: inputData.date,
          time: inputData.time,
          durationMinutes: Number(inputData.duration_minutes ?? 0),
          timezone: inputData.timezone,
        }, { viewerTimeZone: input.viewerTimeZone });
      }
      if (action === "update") {
        return runAgendaAction(input.profileId, {
          action,
          itemId: inputData.item_id || undefined,
          match: inputData.match,
          patch: {
            description: inputData.patch?.description,
            date: inputData.patch?.date,
            time: inputData.patch?.time,
            durationMinutes: inputData.patch?.duration_minutes,
            timezone: inputData.patch?.timezone,
          },
        }, { viewerTimeZone: input.viewerTimeZone });
      }
      if (action === "delete") {
        return runAgendaAction(input.profileId, {
          action,
          itemId: inputData.item_id || undefined,
          match: inputData.match,
        }, { viewerTimeZone: input.viewerTimeZone });
      }
      if (action === "share" || action === "unshare") {
        return runAgendaAction(input.profileId, {
          action,
          itemId: inputData.item_id || undefined,
          match: inputData.match,
          targetProfile: inputData.target_profile,
        }, { viewerTimeZone: input.viewerTimeZone });
      }
      if (action === "list") {
        if (!inputData.range) {
          throw new Error("Range is required for list actions.");
        }
        const range =
          inputData.range.kind === "next_n_days"
            ? {
                kind: "next_n_days" as const,
                days: Number(inputData.range.days ?? 0),
                timezone: inputData.range.timezone,
                weekStart: inputData.range.week_start,
              }
            : {
                kind: inputData.range.kind,
                timezone: inputData.range.timezone,
                weekStart: inputData.range.week_start,
              };
        return runAgendaAction(input.profileId, {
          action,
          range,
          includeOverlaps: inputData.include_overlaps,
        }, { viewerTimeZone: input.viewerTimeZone });
      }
      throw new Error("Unsupported agenda action.");
    },
  });

  return {
    displayWeather,
    displayWeatherForecast,
    displayMemoryPrompt,
    displayMemoryAnswer,
    displayTimezones,
    displayNotes,
    displayList,
    displayListsOverview,
    displayAgenda,
  };
}
