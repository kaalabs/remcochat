import { generateObject } from "ai";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getLanguageModelForProvider } from "@/server/llm-provider";

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
      intent: "none";
      confidence: number;
    };

const IntentSchema = z.object({
  intent: z.enum(["none", "memory_add", "weather_current", "weather_forecast"]),
  confidence: z.number().min(0).max(1),
  memory_candidate: z.string(),
  location: z.string(),
});

const ROUTER_PROMPT = [
  "You are RemcoChat's intent router. Classify ONLY the latest user message.",
  "Choose one intent: none | memory_add | weather_current | weather_forecast.",
  "Only set intent when you are confident; otherwise choose none.",
  "Use memory_add only when the user is asking to store/remember new info, not when they are asking a question about existing memory.",
  "If the user is asking to save a quick note (note this, jot this down, make a note), choose intent=none.",
  "If intent=memory_add, extract a clean memory_candidate that is self-contained and includes context (who/what/why, include relationships/time if stated).",
  "Avoid single-word or context-free fragments; if the message lacks context, choose intent=none.",
  "If intent=weather_current or weather_forecast, extract the location name.",
  "If location is missing or ambiguous, choose intent=none.",
  "Return JSON only.",
].join("\n");

export async function routeIntent(input: {
  text: string;
}): Promise<IntentRoute | null> {
  const router = getConfig().intentRouter;
  if (!router || !router.enabled) return null;

  const text = String(input.text ?? "").trim();
  if (!text) return null;

  const clipped = text.slice(0, router.maxInputChars);
  const resolved = await getLanguageModelForProvider(
    router.providerId,
    router.modelId
  );

  const { object } = await generateObject({
    model: resolved.model,
    schema: IntentSchema,
    prompt: `${ROUTER_PROMPT}\n\nUser message:\n"""${clipped}"""`,
    ...(resolved.capabilities.temperature ? { temperature: 0 } : {}),
  });

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
    default:
      return { intent: "none", confidence };
  }
}
