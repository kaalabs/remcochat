import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getLanguageModelForProvider } from "@/server/llm-provider";
import type { AgendaActionInput } from "@/server/agenda";
import { extractJsonObject } from "@/server/llm-json";

const AgendaRangeSchema = z.object({
  kind: z.enum(["today", "tomorrow", "this_week", "this_month", "next_n_days"]),
  days: z.number().int().optional(),
  timezone: z.string().optional(),
  week_start: z.enum(["monday", "sunday"]).optional(),
});

const AgendaMatchSchema = z.object({
  description: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
});

const AgendaPatchSchema = z.object({
  description: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  duration_minutes: z.number().int().optional(),
  timezone: z.string().optional(),
});

const AgendaIntentSchema = z.object({
  action: z.enum(["create", "update", "delete", "share", "unshare", "list"]),
  description: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  duration_minutes: z.number().int().optional(),
  timezone: z.string().optional(),
  item_id: z.string().optional(),
  match: AgendaMatchSchema.optional(),
  patch: AgendaPatchSchema.optional(),
  target_profile: z.string().optional(),
  range: AgendaRangeSchema.optional(),
});

const ROUTER_PROMPT = [
  "You are RemcoChat's agenda intent extractor.",
  "Extract ONLY the agenda command for the latest user message.",
  "Return JSON only and match the schema exactly.",
  "",
  "Rules:",
  "- Use action=create for new agenda items.",
  "- Use action=update to change existing items; include patch with only the fields to change.",
  "- Use action=delete to remove items.",
  "- Use action=share or action=unshare to share/stop sharing an item with a profile.",
  "- Use action=list for listing windows (today, tomorrow, this week, this month, coming N days).",
  "- If the user asks for the coming/next week, use action=list with range.kind=next_n_days and days=7 unless they explicitly specify a different window.",
  "- If the user asks to show their agenda without specifying a window, choose range.kind=next_n_days with days=30.",
  "",
  "Fields:",
  "- description: concise item description (required for create).",
  "- date: YYYY-MM-DD, time: HH:MM (24h), duration_minutes: integer minutes.",
  "- timezone: IANA timezone if explicitly provided by the user; otherwise omit.",
  "- item_id: if the user provides an explicit id.",
  "- match: when item_id is missing, include best-effort description/date/time to locate the item.",
  "- target_profile: profile name or id for share/unshare.",
  "- range.kind: today | tomorrow | this_week | this_month | next_n_days.",
  "- range.days: required when kind=next_n_days.",
  "- range.week_start: monday or sunday if the user specifies week start.",
].join("\n");

type AgendaCommandResult =
  | { ok: true; command: AgendaActionInput }
  | { ok: false; error: string };

function hasPatch(patch?: Record<string, unknown>) {
  return patch != null && Object.keys(patch).length > 0;
}

async function extractAgendaIntentWithText(input: {
  model: LanguageModel;
  prompt: string;
}) {
  const { text } = await generateText({
    model: input.model,
    prompt: `${input.prompt}\n\nReturn ONLY valid JSON and no other text.`,
  });
  const parsed = extractJsonObject(text);
  return AgendaIntentSchema.parse(parsed);
}

export async function routeAgendaCommand(input: {
  text: string;
}): Promise<AgendaCommandResult> {
  const router = getConfig().intentRouter;
  if (!router || !router.enabled) {
    return { ok: false, error: "Intent routing is disabled." };
  }

  const text = String(input.text ?? "").trim();
  if (!text) return { ok: false, error: "Missing agenda request." };

  const clipped = text.slice(0, router.maxInputChars);
  let resolved;
  try {
    resolved = await getLanguageModelForProvider(
      router.providerId,
      router.modelId
    );
  } catch (err) {
    console.error("Agenda intent router model resolution failed", err);
    return {
      ok: false,
      error:
        "Agenda intent engine is temporarily unavailable. Please try again.",
    };
  }

  let object: z.infer<typeof AgendaIntentSchema>;
  try {
    object = await extractAgendaIntentWithText({
      model: resolved.model,
      prompt: `${ROUTER_PROMPT}\n\nUser message:\n"""${clipped}"""`,
    });
  } catch (err) {
    console.error("Agenda intent extraction failed", err);
    return {
      ok: false,
      error:
        "Agenda intent engine is temporarily unavailable. Please try again or be more specific (for example: 'Add standup on 2026-01-26 at 09:30 for 15 minutes').",
    };
  }

  const action = object.action;

  if (action === "create") {
    if (!object.description || !object.date || !object.time) {
      return {
        ok: false,
        error: "Please provide a description, date, and time for the agenda item.",
      };
    }
    if (!Number.isFinite(object.duration_minutes ?? NaN)) {
      return {
        ok: false,
        error: "Please provide a duration in minutes for the agenda item.",
      };
    }
    return {
      ok: true,
      command: {
        action,
        description: String(object.description),
        date: String(object.date),
        time: String(object.time),
        durationMinutes: Number(object.duration_minutes),
        timezone: object.timezone ? String(object.timezone) : undefined,
      },
    };
  }

  if (action === "list") {
    const rawRange: z.infer<typeof AgendaRangeSchema> =
      object.range ?? ({ kind: "next_n_days", days: 30 } as const);
    if (
      rawRange.kind === "next_n_days" &&
      !Number.isFinite(rawRange.days ?? NaN)
    ) {
      return { ok: false, error: "How many days should I show?" };
    }
    const range =
      rawRange.kind === "next_n_days"
        ? {
            kind: "next_n_days" as const,
            days: Number(rawRange.days),
            timezone: rawRange.timezone ? String(rawRange.timezone) : undefined,
            weekStart: rawRange.week_start ?? undefined,
          }
        : rawRange.kind === "this_week"
          ? {
              kind: "this_week" as const,
              timezone: rawRange.timezone
                ? String(rawRange.timezone)
                : undefined,
              weekStart: rawRange.week_start ?? undefined,
            }
          : {
              kind: rawRange.kind,
              timezone: rawRange.timezone
                ? String(rawRange.timezone)
                : undefined,
            };
    return {
      ok: true,
      command: {
        action,
        range,
        includeOverlaps: true,
      },
    };
  }

  if (action === "update") {
    if (!object.item_id && !object.match) {
      return {
        ok: false,
        error: "Which agenda item should I update?",
      };
    }
    if (!hasPatch(object.patch ?? undefined)) {
      return {
        ok: false,
        error: "What should I change about the agenda item?",
      };
    }
    return {
      ok: true,
      command: {
        action,
        itemId: object.item_id ? String(object.item_id) : undefined,
        match: object.match
          ? {
              description: object.match.description
                ? String(object.match.description)
                : undefined,
              date: object.match.date ? String(object.match.date) : undefined,
              time: object.match.time ? String(object.match.time) : undefined,
            }
          : undefined,
        patch: {
          description: object.patch?.description
            ? String(object.patch.description)
            : undefined,
          date: object.patch?.date ? String(object.patch.date) : undefined,
          time: object.patch?.time ? String(object.patch.time) : undefined,
          durationMinutes: object.patch?.duration_minutes,
          timezone: object.patch?.timezone
            ? String(object.patch.timezone)
            : undefined,
        },
      },
    };
  }

  if (action === "delete") {
    if (!object.item_id && !object.match) {
      return {
        ok: false,
        error: "Which agenda item should I delete?",
      };
    }
    return {
      ok: true,
      command: {
        action,
        itemId: object.item_id ? String(object.item_id) : undefined,
        match: object.match
          ? {
              description: object.match.description
                ? String(object.match.description)
                : undefined,
              date: object.match.date ? String(object.match.date) : undefined,
              time: object.match.time ? String(object.match.time) : undefined,
            }
          : undefined,
      },
    };
  }

  if (action === "share" || action === "unshare") {
    if (!object.item_id && !object.match) {
      return {
        ok: false,
        error: "Which agenda item should I share?",
      };
    }
    if (!object.target_profile) {
      return {
        ok: false,
        error: "Which profile should I share it with?",
      };
    }
    return {
      ok: true,
      command: {
        action,
        itemId: object.item_id ? String(object.item_id) : undefined,
        match: object.match
          ? {
              description: object.match.description
                ? String(object.match.description)
                : undefined,
              date: object.match.date ? String(object.match.date) : undefined,
              time: object.match.time ? String(object.match.time) : undefined,
            }
          : undefined,
        targetProfile: String(object.target_profile),
      },
    };
  }

  return { ok: false, error: "Unsupported agenda action." };
}
