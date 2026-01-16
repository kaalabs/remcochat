export function normalizeNoteContent(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitNoteContent(value: string) {
  const normalized = normalizeNoteContent(value);
  if (!normalized) {
    return { title: "", body: "" };
  }
  const lines = normalized.split("\n").map((line) => line.trim());
  const title = lines.find((line) => line.length > 0) ?? "";
  const bodyLines = lines.slice(lines.indexOf(title) + 1).filter(Boolean);
  return {
    title,
    body: bodyLines.join("\n"),
  };
}
