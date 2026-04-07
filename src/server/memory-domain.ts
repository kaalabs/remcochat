const MAX_MEMORY_CONTENT_LENGTH = 4000;

export function ensureMemoryContent(content: string) {
  const normalized = String(content ?? "").trim();
  if (!normalized) {
    throw new Error("Memory content is required.");
  }
  if (normalized.length > MAX_MEMORY_CONTENT_LENGTH) {
    throw new Error("Memory content is too long.");
  }
  return normalized;
}
