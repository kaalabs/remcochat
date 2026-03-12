import { generateText } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { extractJsonObject } from "@/server/llm-json";
import { getLanguageModelForProvider } from "@/server/llm-provider";
import type { IntentRoute } from "@/server/intent-router";

export const TOOL_SURFACES = [
  "none",
  "display_weather",
  "display_weather_forecast",
  "display_agenda",
  "display_list",
  "display_notes",
  "display_url_summary",
  "display_current_datetime",
  "display_timezones",
  "web",
  "workspace_exec",
  "host_access",
  "obsidian",
  "ov_nl",
  "hue",
] as const;

export type ToolSurface = (typeof TOOL_SURFACES)[number];

export type ToolSurfaceRoute = {
  surface: ToolSurface;
  confidence: number;
};

const ToolSurfaceSchema = z.object({
  surface: z.enum(TOOL_SURFACES),
  confidence: z.number().min(0).max(1).optional(),
});

export const TOOL_SURFACE_ROUTER_PROMPT = [
  "You are RemcoChat's tool-surface router. Classify ONLY the latest user message.",
  "You may be given brief context about the prior assistant response or tool usage; use it only to interpret follow-up commands.",
  "The user message may be in any language. Classify based on meaning, not keyword matching.",
  "Choose exactly one surface: none | display_weather | display_weather_forecast | display_agenda | display_list | display_notes | display_url_summary | display_current_datetime | display_timezones | web | workspace_exec | host_access | obsidian | ov_nl | hue.",
  "Only choose a non-none surface when you are confident; otherwise choose none.",
  "Surface meanings:",
  "- display_weather: current weather request.",
  "- display_weather_forecast: weather forecast request.",
  "- display_agenda: agenda/calendar/schedule request.",
  "- display_list: list/todo/shopping list request.",
  "- display_notes: note-taking or notes overview request.",
  "- display_url_summary: summarize or inspect a URL/page/article request.",
  "- display_current_datetime: current date / current time / today's date request.",
  "- display_timezones: timezone conversion / timezone comparison / time difference request.",
  "- web: latest news, browse/search online, find on the web/internet.",
  "- workspace_exec: run code, run a command, execute a script/program/test/build in the sandbox/workspace/container.",
  "- host_access: explicitly access the local host machine or host filesystem outside the sandbox.",
  "- obsidian: explicitly use Obsidian, the Obsidian vault, or the Obsidian CLI.",
  "- ov_nl: Dutch rail live travel information.",
  "- hue: Philips Hue / smart light control.",
  "Choose workspace_exec for normal code/command execution requests even if the user does not mention bash, shell, or terminal.",
  "Choose host_access only when the user explicitly targets the host/local machine or host/local filesystem; otherwise prefer workspace_exec for execution.",
  "Choose obsidian instead of host_access when the user explicitly wants Obsidian/vault operations.",
  "If the user pasted a URL and wants a summary, choose display_url_summary instead of web.",
  "",
  "Examples:",
  '- "voer een hello-world python programma uit" -> workspace_exec',
  '- "run a hello world python program" -> workspace_exec',
  '- "run npm test in the repo" -> workspace_exec',
  '- "search the web for 3 dutch news headlines of today" -> web',
  '- "get me 3 Dutch news headlines of today" -> web',
  '- "show my agenda for next week" -> display_agenda',
  '- "what is the weather in Amsterdam?" -> display_weather',
  '- "weather forecast for Amsterdam tomorrow" -> display_weather_forecast',
  '- "summarize https://example.com/article" -> display_url_summary',
  '- "what is the current date and time?" -> display_current_datetime',
  '- "what time is it in Tokyo compared to Amsterdam?" -> display_timezones',
  '- "open my local filesystem on the host and read ~/notes/today.txt" -> host_access',
  '- "zoek in mijn obsidian vault naar mijn dagnotities" -> obsidian',
  '- "wat zijn de vertrektijden op utrecht centraal?" -> ov_nl',
  '- "turn the living room lights off" -> hue',
  "Return JSON only.",
].join("\n");

export async function routeToolSurface(input: {
  text: string;
  context?: {
    lastAssistantText?: string;
    lastToolName?: string;
  };
}): Promise<ToolSurfaceRoute | null> {
  const router = getConfig().intentRouter;
  if (!router || !router.enabled) return null;

  const text = String(input.text ?? "").trim();
  if (!text) return null;

  const clipped = text.slice(0, router.maxInputChars);
  let resolved: Awaited<ReturnType<typeof getLanguageModelForProvider>>;
  try {
    resolved = await getLanguageModelForProvider(router.providerId, router.modelId);
  } catch (err) {
    console.error("Tool-surface router model resolution failed", err);
    return null;
  }

  let object: z.infer<typeof ToolSurfaceSchema>;
  try {
    const lastTool = String(input.context?.lastToolName ?? "").trim();
    const lastAssistantText = String(input.context?.lastAssistantText ?? "").trim();
    const contextBlock =
      lastTool || lastAssistantText
        ? [
            "Context (may be empty; use only if helpful):",
            ...(lastTool ? [`- last_tool: ${lastTool}`] : []),
            ...(lastAssistantText
              ? [`- last_assistant_text: \"\"\"${lastAssistantText.slice(0, 800)}\"\"\"`]
              : []),
            "",
          ].join("\n")
        : "";

    const { text } = await generateText({
      model: resolved.model,
      prompt: `${TOOL_SURFACE_ROUTER_PROMPT}\n\n${contextBlock}User message:\n"""${clipped}"""\n\nReturn ONLY valid JSON and no other text.`,
      ...(resolved.capabilities.temperature && !resolved.capabilities.reasoning
        ? { temperature: 0 }
        : {}),
    });
    object = ToolSurfaceSchema.parse(extractJsonObject(text));
  } catch (err) {
    console.error("Tool-surface router request failed", err);
    return null;
  }

  const confidence = normalizeToolSurfaceConfidence({
    surface: object.surface,
    confidence: object.confidence,
  });
  if (confidence < router.minConfidence) {
    return { surface: "none", confidence };
  }

  return {
    surface: object.surface,
    confidence,
  };
}

export function toolSurfaceFromIntentRoute(routedIntent: IntentRoute | null): ToolSurface | null {
  switch (routedIntent?.intent) {
    case "weather_current":
      return "display_weather";
    case "weather_forecast":
      return "display_weather_forecast";
    case "agenda":
      return "display_agenda";
    case "ov_nl":
      return "ov_nl";
    default:
      return null;
  }
}

export function normalizeToolSurfaceConfidence(input: {
  surface: ToolSurface;
  confidence?: number | null;
}): number {
  if (typeof input.confidence === "number" && Number.isFinite(input.confidence)) {
    return Math.max(0, Math.min(1, input.confidence));
  }
  return input.surface === "none" ? 0 : 1;
}

export function inferFallbackToolSurface(text: string): ToolSurface {
  const value = String(text ?? "").trim();
  if (!value) return "none";

  const lower = value.toLowerCase();

  if (
    /\b(obsidian|vault|dagnotities|daily note|daily notes)\b/i.test(value)
  ) {
    return "obsidian";
  }

  if (
    /\b(host|local machine|local filesystem|local file|home directory|desktop|lokale machine|lokale bestanden?|lokaal bestand|lokale filesystem)\b/i.test(
      value,
    )
  ) {
    return "host_access";
  }

  const hasExecutionVerb =
    /\b(run|execute|start|launch|compile|build|test|lint|debug|voer(?:\s+\S+){0,4}\s+uit|uitvoeren|draai|starten)\b/i.test(
      value,
    ) || lower.includes("voer een") && lower.includes(" uit");
  const hasExecutionTarget =
    /\b(python|py\b|programma|program|script|code|commando|command|terminal|shell|bash|npm|node|repo|repository|workspace|project|test suite|build)\b/i.test(
      value,
    );

  if (hasExecutionVerb && hasExecutionTarget) {
    return "workspace_exec";
  }

  if (
    /(https?:\/\/\S+)|\b(summarize|summary|samenvat|samenvatting)\b.*\b(link|url|page|article|website|pagina|artikel|site)\b/i.test(
      value,
    )
  ) {
    return "display_url_summary";
  }

  if (
    /\b(search|look up|lookup|browse|internet|web|latest|current news|find online|zoek online|zoek op internet|nieuws|headlines|krantenkoppen)\b/i.test(
      value,
    )
  ) {
    return "web";
  }

  if (/\b(list|todo|to-do|shopping list|grocery|lijst|takenlijst|boodschappenlijst)\b/i.test(value)) {
    return "display_list";
  }

  if (/\b(note|notes|jot|write down|notitie|notities|schrijf op)\b/i.test(value)) {
    return "display_notes";
  }

  return "none";
}

export function resolveToolSurfaceDecision(input: {
  routedToolSurface: ToolSurfaceRoute | null;
  routedIntent: IntentRoute | null;
  lastUserText?: string;
  forceOvNlTool?: boolean;
  hueSkillRelevant?: boolean;
}): ToolSurface {
  if (input.hueSkillRelevant) return "hue";
  if (input.forceOvNlTool) return "ov_nl";

  const routedSurface = input.routedToolSurface?.surface ?? "none";
  if (routedSurface !== "none") return routedSurface;

  return (
    toolSurfaceFromIntentRoute(input.routedIntent) ??
    inferFallbackToolSurface(input.lastUserText ?? "")
  );
}
