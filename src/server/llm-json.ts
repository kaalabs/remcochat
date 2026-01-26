export function extractJsonObject(text: string) {
  const raw = String(text ?? "").trim();

  // Common case: the model returns a single JSON object.
  if (raw.startsWith("{") && raw.endsWith("}")) {
    return JSON.parse(raw);
  }

  // Handle fenced code blocks.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const candidate = fenced[1].trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return JSON.parse(candidate);
    }
  }

  // Fallback: slice between first "{" and last "}".
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found.");
  }
  return JSON.parse(raw.slice(start, end + 1));
}
