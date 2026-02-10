import { generateText } from "ai";
import type { UiLanguage } from "@/lib/types";
import { getLanguageModelForActiveProvider } from "@/server/llm-provider";
import { extractJsonObject } from "@/server/llm-json";

export type OpeningMessageResult = {
  message: string;
  lang: UiLanguage;
  source: "pool" | "fallback";
};

export const OPENING_MESSAGE_FALLBACKS = {
  en: [
    "Drop a topic and I will pretend I already had coffee.",
    "Say the word and my keyboard will do a tiny happy dance.",
    "Pick a mission and I will bring the digital confetti.",
    "Start typing and I will turn chaos into a neat plan.",
    "Give me a challenge and I will flex my pixels.",
    "Tell me what is up and we will make it useful fast.",
  ],
  nl: [
    "Roep iets en ik doe alsof ik al drie koppen koffie op heb.",
    "Typ je vraag en mijn toetsenbord doet een blij dansje.",
    "Geef me een missie en ik strooi digitale confetti.",
    "Start met typen en ik maak van chaos een strak plan.",
    "Gooi een uitdaging mijn kant op en ik zet mijn pixels aan het werk.",
    "Vertel wat er speelt en we maken het snel bruikbaar.",
  ],
} satisfies Record<UiLanguage, readonly string[]>;

const OPENING_MESSAGE_POOL_TARGET = 6;
const OPENING_MESSAGE_BATCH_SIZE = 8;
const OPENING_MESSAGE_MAX_LENGTH = 120;

const openingMessagePools: Record<UiLanguage, string[]> = {
  en: [],
  nl: [],
};

const refillInFlight: Partial<Record<UiLanguage, Promise<void>>> = {};

type OpeningMessageBatchGenerator = (input: {
  lang: UiLanguage;
  count: number;
}) => Promise<string[]>;

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(value: unknown): string {
  return normalizeWhitespace(value).toLowerCase();
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^["'`\u2018\u2019\u201C\u201D]+|["'`\u2018\u2019\u201C\u201D]+$/g, "");
}

function firstSentence(value: string): string {
  const match = value.match(/^[^.!?]+[.!?]/);
  if (match?.[0]) return match[0].trim();
  return value;
}

export function sanitizeOpeningMessage(raw: unknown): string | null {
  let value = String(raw ?? "");
  if (!value.trim()) return null;

  value = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`+/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^\s*[-*•]\s+/g, "")
    .replace(/[*_#~>]/g, " ");

  value = value.split(/\r?\n/)[0] ?? value;
  value = stripWrappingQuotes(normalizeWhitespace(value));
  if (!value) return null;

  value = firstSentence(value);
  value = stripWrappingQuotes(normalizeWhitespace(value));
  if (!value) return null;

  if (!/[.!?]$/.test(value)) {
    value = `${value}.`;
  }

  if (value.length > OPENING_MESSAGE_MAX_LENGTH) return null;
  if (/(https?:\/\/|www\.)/i.test(value)) return null;
  if (/(^|\s)(as an ai|i am unable|i'm unable|i cannot|i can't)(\s|$)/i.test(value)) {
    return null;
  }
  if (/\|/.test(value)) return null;

  return value;
}

function dedupeMessages(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const sanitized = sanitizeOpeningMessage(value);
    if (!sanitized) continue;
    const key = normalizeForCompare(sanitized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(sanitized);
  }

  return out;
}

function fallbackForLanguage(lang: UiLanguage, exclude: Set<string>): string {
  const available = OPENING_MESSAGE_FALLBACKS[lang].map((entry) =>
    sanitizeOpeningMessage(entry)
  );

  for (const candidate of available) {
    if (!candidate) continue;
    if (!exclude.has(normalizeForCompare(candidate))) return candidate;
  }

  for (const candidate of available) {
    if (candidate) return candidate;
  }

  // Should never happen because constants are static and valid.
  return lang === "nl"
    ? "Typ iets en dan gaan we los."
    : "Type something and let us get moving.";
}

async function generateBatchFromModel(input: {
  lang: UiLanguage;
  count: number;
}): Promise<string[]> {
  const resolved = await getLanguageModelForActiveProvider(undefined);
  const languageName = input.lang === "nl" ? "Dutch (Netherlands)" : "English";

  const prompt = [
    `Generate ${input.count} unique opening messages in ${languageName}.`,
    "Goal: invite the user to start chatting in a funny, friendly way.",
    "Requirements:",
    "- exactly one short sentence per message",
    "- no markdown",
    "- no links",
    "- no quotes around the sentence",
    "- safe and non-offensive",
    "Return JSON only with this shape:",
    '{"messages":["..."]}',
  ].join("\n");

  const { text } = await generateText({
    model: resolved.model,
    prompt,
    ...(resolved.capabilities.temperature && !resolved.capabilities.reasoning
      ? { temperature: 0 }
      : {}),
  });

  const parsed = extractJsonObject(text) as { messages?: unknown };
  if (!Array.isArray(parsed.messages)) return [];
  return parsed.messages.map((entry) => String(entry ?? ""));
}

async function refillPoolOnce(
  lang: UiLanguage,
  generator: OpeningMessageBatchGenerator
): Promise<void> {
  let generated: string[] = [];
  try {
    generated = await generator({
      lang,
      count: OPENING_MESSAGE_BATCH_SIZE,
    });
  } catch {
    generated = [];
  }

  const merged = dedupeMessages([
    ...generated,
    ...openingMessagePools[lang],
    ...OPENING_MESSAGE_FALLBACKS[lang],
  ]);

  openingMessagePools[lang] = merged.slice(0, OPENING_MESSAGE_POOL_TARGET);
}

async function ensurePool(
  lang: UiLanguage,
  generator: OpeningMessageBatchGenerator
): Promise<void> {
  if (openingMessagePools[lang].length >= OPENING_MESSAGE_POOL_TARGET) return;

  if (!refillInFlight[lang]) {
    refillInFlight[lang] = refillPoolOnce(lang, generator).finally(() => {
      delete refillInFlight[lang];
    });
  }

  await refillInFlight[lang];
}

function pickFromPool(lang: UiLanguage, exclude: Set<string>): string | null {
  for (const candidate of openingMessagePools[lang]) {
    if (!exclude.has(normalizeForCompare(candidate))) {
      return candidate;
    }
  }
  return null;
}

function rotatePoolAfterPick(lang: UiLanguage, picked: string): void {
  const idx = openingMessagePools[lang].findIndex(
    (entry) => normalizeForCompare(entry) === normalizeForCompare(picked)
  );
  if (idx < 0) return;

  const [entry] = openingMessagePools[lang].splice(idx, 1);
  if (!entry) return;
  openingMessagePools[lang].push(entry);
}

export async function getOpeningMessage(
  input: {
    lang: UiLanguage;
    exclude?: string[];
  },
  options?: {
    generateBatch?: OpeningMessageBatchGenerator;
  }
): Promise<OpeningMessageResult> {
  const lang = input.lang;
  const exclude = new Set(
    (input.exclude ?? [])
      .map((entry) => normalizeForCompare(entry))
      .filter(Boolean)
  );

  const generateBatch = options?.generateBatch ?? generateBatchFromModel;

  await ensurePool(lang, generateBatch);

  let picked = pickFromPool(lang, exclude);

  if (!picked) {
    await refillPoolOnce(lang, generateBatch);
    picked = pickFromPool(lang, exclude);
  }

  if (!picked) {
    return {
      message: fallbackForLanguage(lang, exclude),
      lang,
      source: "fallback",
    };
  }

  rotatePoolAfterPick(lang, picked);

  return {
    message: picked,
    lang,
    source: "pool",
  };
}

export const __test__ = {
  clearPools(): void {
    openingMessagePools.en = [];
    openingMessagePools.nl = [];
  },
  setPool(lang: UiLanguage, values: string[]): void {
    openingMessagePools[lang] = dedupeMessages(values).slice(
      0,
      OPENING_MESSAGE_POOL_TARGET
    );
  },
  getPool(lang: UiLanguage): string[] {
    return [...openingMessagePools[lang]];
  },
  normalizeForCompare,
};
