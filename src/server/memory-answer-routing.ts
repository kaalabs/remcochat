export function looksLikeTimeRequest(text: string) {
  return (
    /\b(time|timezone|timezones|current time|what time|time in|local time)\b/.test(
      text
    ) || /\b(utc|gmt)\b/.test(text)
  );
}

export function looksLikeWeatherRequest(text: string) {
  return /\b(weather|forecast|temperature|rain|snow|wind)\b/.test(text);
}

export function looksLikeUrlSummaryRequest(text: string) {
  return /\b(summarize|summary)\b/.test(text) && /https?:\/\//.test(text);
}

export function looksLikeNotesRequest(text: string) {
  return /\b(note|notes|jot|remember this|save this)\b/.test(text);
}

export function looksLikeListsRequest(text: string) {
  return /\b(list|todo|to-do|shopping)\b/.test(text);
}

export function looksLikeAgendaRequest(text: string) {
  return /\b(agenda|schedule|calendar|meeting|appointment)\b/.test(text);
}

function looksLikeDeviceControlRequest(text: string) {
  // Avoid forcing memory UI for real-world control intents (e.g. Hue lights).
  // The model should be free to pick skills/tools here.
  if (!text) return false;

  const hasLightWords = /\b(light|lights|lamp|lamps|hue|scene|scenes)\b/.test(text);
  const hasControlVerb =
    /\b(turn|switch)\s+(on|off)\b/.test(text) ||
    /\b(dim|brighten)\b/.test(text) ||
    /\b(set|make|activate)\b/.test(text);

  return hasLightWords && hasControlVerb;
}

function looksLikeMemoryQuestion(text: string) {
  if (!text) return false;

  // Explicit memory phrasing (strong signal).
  if (
    /\b(profile memory|from memory|in memory|do you remember|did i tell you|what do you remember)\b/.test(
      text
    ) || /\bmemory\b/.test(text)
  ) {
    return true;
  }

  // Common question-like forms where memory is plausibly the intended source.
  return (
    /\?\s*$/.test(text) ||
    /^(what|what's|whats|where|when|who|how|which|do|did|does|is|are|am|can|could|would|should)\b/.test(
      text
    ) ||
    /\b(tell me|remind me)\b/.test(text)
  );
}

export function shouldForceMemoryAnswerTool(userText: string, memoryLines: string[]) {
  const text = String(userText ?? "").trim().toLowerCase();
  if (!text) return false;
  if (!Array.isArray(memoryLines) || memoryLines.length === 0) return false;

  // Slash commands (including explicit skills) should not be overridden.
  if (text.startsWith("/")) return false;

  if (
    looksLikeTimeRequest(text) ||
    looksLikeWeatherRequest(text) ||
    looksLikeUrlSummaryRequest(text) ||
    looksLikeNotesRequest(text) ||
    looksLikeListsRequest(text) ||
    looksLikeAgendaRequest(text)
  ) {
    return false;
  }

  if (looksLikeDeviceControlRequest(text)) return false;

  const explicitlyRequestsMemory =
    /\b(profile memory|from memory|in memory|do you remember|did i tell you|what do you remember)\b/.test(
      text
    ) || /\bmemory\b/.test(text);

  // Only force the memory answer tool for messages that look like a question
  // (or explicitly ask about memory). Avoid forcing on imperative/action text.
  const questionLike = looksLikeMemoryQuestion(text);
  if (!questionLike && !explicitlyRequestsMemory) return false;

  const rawTokens = text.match(/[a-z0-9]+/g) ?? [];
  const queryTokens = new Set(rawTokens.filter((token) => token.length >= 4));
  for (let i = 0; i + 1 < rawTokens.length; i += 1) {
    const a = rawTokens[i];
    const b = rawTokens[i + 1];
    if (!a || !b) continue;
    if (a.length < 3 || b.length < 3) continue;
    queryTokens.add(`${a}${b}`);
  }
  if (queryTokens.size === 0) return explicitlyRequestsMemory;

  for (const line of memoryLines) {
    const lineRawTokens =
      String(line ?? "")
        .toLowerCase()
        .match(/[a-z0-9]+/g) ?? [];
    const lineTokens = lineRawTokens.filter((token) => token.length >= 4);
    for (const token of lineTokens) {
      if (queryTokens.has(token)) return true;
    }
    for (let i = 0; i + 1 < lineRawTokens.length; i += 1) {
      const a = lineRawTokens[i];
      const b = lineRawTokens[i + 1];
      if (!a || !b) continue;
      if (a.length < 3 || b.length < 3) continue;
      if (queryTokens.has(`${a}${b}`)) return true;
    }
  }

  return explicitlyRequestsMemory;
}
