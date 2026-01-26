function normalizeDecisionText(text: string) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,]/g, "")
    .replace(/['"]/g, "")
    .replace(/\s+/g, " ");
}

export function parseMemorizeDecision(text: string) {
  const normalized = normalizeDecisionText(text);
  if (!normalized) return null;

  const confirm = new Set([
    "confirm",
    "confirm memory",
    "confirm memorize",
    "confirm memorization",
    "confirm save",
    "confirm it",
    "yes",
    "yes please",
    "ok",
    "okay",
    "sure",
    "save it",
    "save this",
    "please save",
  ]);

  const cancel = new Set([
    "cancel",
    "cancel memory",
    "cancel memorize",
    "cancel memorization",
    "cancel save",
    "cancel it",
    "no",
    "no thanks",
    "dont save",
    "do not save",
    "nope",
    "stop",
    "skip",
  ]);

  if (confirm.has(normalized)) return "confirm";
  if (cancel.has(normalized)) return "cancel";
  if (normalized.startsWith("confirm ")) return "confirm";
  if (normalized.startsWith("cancel ")) return "cancel";
  return null;
}

function stripLeadingPreamble(text: string) {
  return text
    .replace(/^\s*please\s+/i, "")
    .replace(/^\s*(?:can|could|would|will)\s+you\s+/i, "");
}

function stripMemoryCommandPrefix(text: string) {
  const stripped = stripLeadingPreamble(text).trim();

  const patterns: RegExp[] = [
    /^\s*(?:memorize|remember)\s+this\s*[:,-]\s*/i,
    /^\s*(?:memorize|remember)\s*[:,-]\s*/i,
    /^\s*remember\s+that\s+/i,
    /^\s*memorize\s+that\s+/i,
    /^\s*(?:save|store)\s+this\s+in\s+(?:your\s+)?memory\s*[:,-]?\s*/i,
    /^\s*(?:save|store)\s+(?:this\s+)?to\s+(?:your\s+)?memory\s*[:,-]?\s*/i,
    /^\s*(?:save|store)\s+this\s*[:,-]\s*/i,
    /^\s*(?:save|store)\s+(?:in|to)\s+(?:your\s+)?memory\s*[:,-]?\s*/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(stripped)) {
      return stripped.replace(pattern, "");
    }
  }

  return null;
}

export function parseMemoryAddCommand(text: string) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase();
  if (normalized.startsWith("remember when ")) return null;
  if (normalized.startsWith("remember how ")) return null;

  const candidate = stripMemoryCommandPrefix(raw);
  if (candidate == null) return null;
  const cleaned = candidate.trim();
  if (!cleaned) return null;
  return cleaned;
}
