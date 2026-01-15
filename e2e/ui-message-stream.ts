type UIMessageChunk = {
  type: string;
  [key: string]: unknown;
};

export function parseUIMessageStreamChunks(body: Buffer | string): UIMessageChunk[] {
  const text = typeof body === "string" ? body : body.toString("utf8");
  const events = text.split("\n\n");

  const chunks: UIMessageChunk[] = [];
  for (const event of events) {
    const trimmed = event.trim();
    if (!trimmed) continue;

    for (const line of trimmed.split("\n")) {
      const lineTrimmed = line.trim();
      if (!lineTrimmed.startsWith("data:")) continue;

      const raw = lineTrimmed.slice("data:".length).trim();
      if (!raw || raw === "[DONE]") continue;

      chunks.push(JSON.parse(raw) as UIMessageChunk);
    }
  }

  return chunks;
}

export function getUIMessageStreamErrors(chunks: UIMessageChunk[]): string[] {
  return chunks
    .filter((c) => c.type === "error")
    .map((c) => String(c.errorText ?? "Unknown error"));
}

export function getUIMessageStreamText(chunks: UIMessageChunk[]): string {
  return chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => String(c.delta ?? ""))
    .join("");
}

