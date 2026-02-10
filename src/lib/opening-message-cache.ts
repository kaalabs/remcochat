import type { UiLanguage } from "@/lib/types";

export type OpeningMessageCache = {
  current: string;
  next: string;
  updatedAt: string;
};

const OPENING_MESSAGE_CACHE_PREFIX = "remcochat:openingMessage:v1:";

function normalizeMessage(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toIsoNow(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function safeFallback(value: unknown): string {
  const fallback = normalizeMessage(value);
  return fallback || "Start chatting.";
}

function chooseDistinctCandidate(
  displayed: string,
  candidates: unknown[],
  fallback: string
): string {
  for (const candidate of candidates) {
    const normalized = normalizeMessage(candidate);
    if (!normalized) continue;
    if (normalized !== displayed) return normalized;
  }
  if (fallback !== displayed) return fallback;
  return displayed;
}

export function openingMessageCacheKey(lang: UiLanguage): string {
  return `${OPENING_MESSAGE_CACHE_PREFIX}${lang}`;
}

export function parseOpeningMessageCache(raw: unknown): OpeningMessageCache | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OpeningMessageCache> | null;
    if (!parsed || typeof parsed !== "object") return null;

    const current = normalizeMessage(parsed.current);
    const next = normalizeMessage(parsed.next);
    const updatedAt = normalizeMessage(parsed.updatedAt);

    if (!current || !next || !updatedAt) return null;
    if (!Number.isFinite(Date.parse(updatedAt))) return null;

    return { current, next, updatedAt };
  } catch {
    return null;
  }
}

export function selectOpeningMessageFromCache(input: {
  cache: OpeningMessageCache | null;
  fallback: string;
  now?: Date;
}): {
  displayed: string;
  nextCache: OpeningMessageCache;
} {
  const fallback = safeFallback(input.fallback);
  const current = normalizeMessage(input.cache?.current);
  const next = normalizeMessage(input.cache?.next);

  const displayed = next || current || fallback;
  const candidateNext = chooseDistinctCandidate(
    displayed,
    [current, next, fallback],
    fallback
  );

  return {
    displayed,
    nextCache: {
      current: displayed,
      next: candidateNext,
      updatedAt: toIsoNow(input.now),
    },
  };
}

export function mergeOpeningMessageNext(input: {
  displayed: string;
  next: string;
  fallback: string;
  now?: Date;
}): OpeningMessageCache {
  const fallback = safeFallback(input.fallback);
  const displayed = normalizeMessage(input.displayed) || fallback;
  const next = chooseDistinctCandidate(displayed, [input.next], fallback);

  return {
    current: displayed,
    next,
    updatedAt: toIsoNow(input.now),
  };
}

export function readOpeningMessageCache(lang: UiLanguage): OpeningMessageCache | null {
  if (typeof window === "undefined") return null;

  try {
    return parseOpeningMessageCache(
      window.localStorage.getItem(openingMessageCacheKey(lang))
    );
  } catch {
    return null;
  }
}

export function writeOpeningMessageCache(
  lang: UiLanguage,
  cache: OpeningMessageCache
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      openingMessageCacheKey(lang),
      JSON.stringify(cache)
    );
  } catch {
    // Ignore unavailable or full storage.
  }
}

export function rotateOpeningMessageCache(
  lang: UiLanguage,
  fallback: string
): {
  displayed: string;
  cache: OpeningMessageCache;
} {
  const selected = selectOpeningMessageFromCache({
    cache: readOpeningMessageCache(lang),
    fallback,
  });

  writeOpeningMessageCache(lang, selected.nextCache);

  return {
    displayed: selected.displayed,
    cache: selected.nextCache,
  };
}

export function storeOpeningMessageNext(
  lang: UiLanguage,
  input: {
    displayed: string;
    next: string;
    fallback: string;
  }
): OpeningMessageCache {
  const cache = mergeOpeningMessageNext(input);
  writeOpeningMessageCache(lang, cache);
  return cache;
}
