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

export function getToolStdoutByName(
  chunks: UIMessageChunk[],
  toolName: string,
): string {
  const toolNamesByCallId = new Map<string, string>();

  for (const chunk of chunks) {
    const type = String(chunk.type ?? "");
    if (
      type !== "tool-input-start" &&
      type !== "tool-input-available" &&
      type !== "tool-input-error"
    ) {
      continue;
    }

    const callId =
      typeof chunk.toolCallId === "string" ? String(chunk.toolCallId) : "";
    const chunkToolName =
      typeof chunk.toolName === "string" ? String(chunk.toolName) : "";
    if (callId && chunkToolName) toolNamesByCallId.set(callId, chunkToolName);
  }

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value && typeof value === "object");
  };

  return chunks
    .filter((chunk) => {
      const type = String(chunk.type ?? "");
      if (type !== "tool-output-available" && type !== "tool-result") {
        return false;
      }

      const callId =
        typeof chunk.toolCallId === "string" ? String(chunk.toolCallId) : "";
      const chunkToolName =
        typeof chunk.toolName === "string"
          ? String(chunk.toolName)
          : callId
            ? toolNamesByCallId.get(callId) ?? ""
            : "";
      return chunkToolName === toolName;
    })
    .map((chunk) => {
      const payload =
        chunk.output ?? chunk.result ?? chunk.toolOutput ?? chunk.toolResult;
      if (!isRecord(payload)) return "";
      return typeof payload.stdout === "string" ? payload.stdout : "";
    })
    .filter(Boolean)
    .join("\n");
}
