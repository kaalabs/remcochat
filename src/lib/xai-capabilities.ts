export type XaiReasoningEffortSupport =
  | "supported"
  | "unsupported"
  | "unknown";

const XAI_REASONING_UNSUPPORTED_MODEL_IDS = new Set<string>([
  "grok-4-1",
  "grok-4-1-fast",
  "grok-4-1-fast-non-reasoning",
  "grok-4",
  "grok-4-0709",
  "grok-4-latest",
  "grok-4-fast-non-reasoning",
  "grok-3",
  "grok-3-latest",
  "grok-3-fast",
  "grok-3-fast-latest",
  "grok-2",
  "grok-2-1212",
  "grok-2-latest",
  "grok-2-vision",
  "grok-2-vision-latest",
  "grok-2-vision-1212",
  "grok-2-image",
  "grok-2-image-latest",
  "grok-2-image-1212",
  "grok-beta",
  "grok-vision-beta",
]);

function normalizeModelId(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function xaiReasoningEffortSupport(
  modelId: string | undefined
): XaiReasoningEffortSupport {
  const id = normalizeModelId(modelId);
  if (!id) return "unknown";

  // Prefer explicit naming signals first for forward compatibility.
  if (id.includes("non-reasoning")) return "unsupported";
  if (id.includes("reasoning")) return "supported";

  // Current xAI chat/reasoning model families with reasoning-effort support.
  if (id === "grok-code-fast-1") return "supported";
  if (id.startsWith("grok-3-mini")) return "supported";

  // Explicitly unsupported models from current provider docs.
  if (XAI_REASONING_UNSUPPORTED_MODEL_IDS.has(id)) return "unsupported";

  return "unknown";
}
