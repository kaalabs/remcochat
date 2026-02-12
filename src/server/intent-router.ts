import { generateText } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getLanguageModelForProvider } from "@/server/llm-provider";
import { extractJsonObject } from "@/server/llm-json";

export type IntentRoute =
  | {
      intent: "memory_add";
      confidence: number;
      memoryCandidate: string;
    }
  | {
      intent: "weather_current" | "weather_forecast";
      confidence: number;
      location: string;
    }
  | {
      intent: "agenda";
      confidence: number;
    }
  | {
      intent: "ov_nl";
      confidence: number;
    }
  | {
      intent: "none";
      confidence: number;
    };

export const OV_NL_ROUTER_MIN_CONFIDENCE = 0.9;

const IntentSchema = z.object({
  intent: z.enum([
    "none",
    "memory_add",
    "weather_current",
    "weather_forecast",
    "agenda",
    "ov_nl",
  ]),
  confidence: z.number().min(0).max(1),
  memory_candidate: z.string().optional().default(""),
  location: z.string().optional().default(""),
  agenda_request: z.string().optional().default(""),
});

const ROUTER_PROMPT = [
  "You are RemcoChat's intent router. Classify ONLY the latest user message.",
  "You may be given brief context about the prior assistant response or tool usage; use it only to interpret follow-up commands.",
  "The user message may be in any language. Classify based on meaning, not keyword matching.",
  "Choose one intent: none | memory_add | weather_current | weather_forecast | agenda | ov_nl.",
  "Only set intent when you are confident; otherwise choose none.",
  "If the user explicitly asks to memorize/remember/save/store something in memory, choose intent=memory_add and extract the memory_candidate (omit the command phrase). Set confidence high (>=0.85) for clear memory requests.",
  "Use memory_add only when the user is asking to store/remember new info, not when they are asking a question about existing memory.",
  "If the user is asking to save a quick note (note this, jot this down, make a note), choose intent=none.",
  "If the user is asking to add, change, delete, share, or view agenda/calendar/schedule items (including time windows like 'coming week' / 'next week'), choose intent=agenda.",
  "If the user is asking for Dutch rail / NS live travel info (stations, departure/arrival boards, trips between stations, platforms/tracks, disruptions/delays/cancellations), choose intent=ov_nl.",
  "Use ov_nl only when the user wants Dutch rail live travel information that should be answered via the ovNlGateway tool.",
  "If the user is doing general travel planning, asking for walking/driving directions, talking about an address (e.g. 'my house'), or just mentioning the Netherlands ('NL') without a concrete rail request, choose intent=none.",
  "If context indicates the last_tool was ovNlGateway and the user sends a short follow-up refinement (later/earlier, fewer transfers, direct-only, change from/to), choose intent=ov_nl.",
  "If intent=memory_add, extract a clean memory_candidate that is self-contained and includes context (who/what/why, include relationships/time if stated).",
  "Avoid single-word or context-free fragments; if the message lacks context, choose intent=none.",
  "If intent=weather_current or weather_forecast, extract the location name.",
  "If location is missing or ambiguous, choose intent=none.",
  "If intent=agenda, set agenda_request to a concise restatement of the user's agenda intent.",
  "",
  "Examples (intent only):",
  '- "show my agenda for the coming week" -> agenda',
  '- "what do I have scheduled next week?" -> agenda',
  '- "memorize my timezone is Europe/Amsterdam" -> memory_add',
  '- "remember this: my timezone is Europe/Amsterdam" -> memory_add',
  '- "remember this: my passport number is ..." -> memory_add',
  '- "onthoud dit: mijn tijdzone is Europe/Amsterdam" -> memory_add',
  '- "wat is het weer in amsterdam?" -> weather_current',
  '- "note this: buy milk" -> none',
  '- "weather in amsterdam" -> weather_current',
  '- "wat zijn de vertrektijden op utrecht centraal?" -> ov_nl',
  '- "van amsterdam centraal naar utrecht centraal vandaag" -> ov_nl',
  '- "zijn er storingen tussen rotterdam en den haag?" -> ov_nl',
  '- "walk" -> none',
  '- "NL" -> none',
  '- "my house" -> none',
  "Return JSON only.",
].join("\n");

export async function routeIntent(input: {
  text: string;
  context?: {
    lastAssistantText?: string;
    lastToolName?: string;
  };
}): Promise<IntentRoute | null> {
  const router = getConfig().intentRouter;
  if (!router || !router.enabled) return null;

  const text = String(input.text ?? "").trim();
  if (!text) return null;

  const clipped = text.slice(0, router.maxInputChars);
  let resolved: Awaited<ReturnType<typeof getLanguageModelForProvider>>;
  try {
    resolved = await getLanguageModelForProvider(router.providerId, router.modelId);
  } catch (err) {
    console.error("Intent router model resolution failed", err);
    return { intent: "none", confidence: 0 };
  }

  let object: z.infer<typeof IntentSchema>;
  try {
    const lastTool = String(input.context?.lastToolName ?? "").trim();
    const lastAssistantText = String(input.context?.lastAssistantText ?? "").trim();
    const contextBlock =
      lastTool || lastAssistantText
        ? [
            "Context (may be empty; use only if helpful):",
            ...(lastTool ? [`- last_tool: ${lastTool}`] : []),
            ...(lastAssistantText
              ? [`- last_assistant_text: """${lastAssistantText.slice(0, 800)}"""`]
              : []),
            "",
          ].join("\n")
        : "";

    const { text } = await generateText({
      model: resolved.model,
      prompt: `${ROUTER_PROMPT}\n\n${contextBlock}User message:\n"""${clipped}"""\n\nReturn ONLY valid JSON and no other text.`,
      ...(resolved.capabilities.temperature && !resolved.capabilities.reasoning
        ? { temperature: 0 }
        : {}),
    });
    object = IntentSchema.parse(extractJsonObject(text));
  } catch {
    // Treat router failures as "no intent" to avoid disrupting chat.
    return { intent: "none", confidence: 0 };
  }

  const confidence = Math.max(0, Math.min(1, Number(object.confidence ?? 0)));
  if (confidence < router.minConfidence) {
    return { intent: "none", confidence };
  }
  switch (object.intent) {
    case "memory_add": {
      const memoryCandidate = String(object.memory_candidate ?? "").trim();
      if (!memoryCandidate) {
        return { intent: "none", confidence };
      }
      return { intent: "memory_add", confidence, memoryCandidate };
    }
    case "weather_current":
    case "weather_forecast": {
      const location = String(object.location ?? "").trim();
      if (!location) {
        return { intent: "none", confidence };
      }
      return { intent: object.intent, confidence, location };
    }
    case "agenda":
      return { intent: "agenda", confidence };
    case "ov_nl":
      return { intent: "ov_nl", confidence };
    default:
      return { intent: "none", confidence };
  }
}
