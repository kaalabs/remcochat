import { tool as createTool, type LanguageModel } from "ai";
import { z } from "zod";
import { getWeatherForLocation, getWeatherForecastForLocation } from "@/ai/weather";
import { getTimezones } from "@/ai/timezones";
import { getUrlSummary } from "@/ai/url-summary";
import { runListAction } from "@/server/lists";
import { runNoteAction } from "@/server/notes";

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

function createUrlSummaryTool(options: {
  model?: LanguageModel;
  supportsTemperature?: boolean;
}) {
  return createTool({
    description: "Summarize a single URL and display it in a summary card.",
    inputSchema: z.object({
      url: z.string().describe("The URL to summarize."),
      length: z
        .enum(["short", "medium", "long"])
        .describe("Summary length preset.")
        .default("medium"),
      focus: z
        .string()
        .describe("Optional focus area, like pricing or risks.")
        .default(""),
      language: z
        .string()
        .describe("Optional output language, or 'auto'.")
        .default("auto"),
    }),
    execute: async ({ url, length, focus, language }) => {
      if (!options.model) {
        throw new Error("URL summaries are unavailable for this model.");
      }
      return getUrlSummary({
        url,
        length,
        focus,
        language,
        model: options.model,
        supportsTemperature: options.supportsTemperature,
      });
    },
  });
}

export function createTools(input: {
  profileId: string;
  summaryModel?: LanguageModel;
  summarySupportsTemperature?: boolean;
}) {
  const displayUrlSummary = createUrlSummaryTool({
    model: input.summaryModel,
    supportsTemperature: input.summarySupportsTemperature,
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

  return {
    displayWeather,
    displayWeatherForecast,
    displayMemoryAnswer,
    displayTimezones,
    displayUrlSummary,
    displayNotes,
    displayList,
  };
}
