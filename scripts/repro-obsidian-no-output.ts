import { POST } from "../src/app/api/chat/route";

type ToolCount = Record<string, number>;

function inc(map: ToolCount, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

async function main() {
  const prompt =
    "lees\n" +
    "  mijn dagnotities van gisteren en vandaag in obsidian, geef een\n" +
    "  samenvatting en maak een lijstje van acties die ik zou moeten\n" +
    "  plannen die nog niet gepland zijn.";

  const body = {
    profileId: "GzvrFppF-My437r9ReIxb",
    chatId: "m2SL5gsfvKMTbfDBkVFlc",
    temporary: false,
    messages: [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: prompt }],
      },
    ],
  };

  const req = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      host: "localhost",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const res = await POST(req);
  if (!res.body) throw new Error("No response body.");

  const toolCalls: ToolCount = {};
  let textChars = 0;
  let finishReason: string | null = null;
  let rawChars = 0;
  let textPreview = "";

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";
  let linesParsed = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = typeof value === "string" ? value : decoder.decode(value, { stream: true });
      rawChars += chunk.length;
      buf += chunk;

      // Parse line-based JSON-ish protocol (best-effort).
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;

        // Common SSE-ish framing.
        const payload = line.startsWith("data:") ? line.slice("data:".length).trim() : line;
        if (!payload) continue;
        if (payload === "[DONE]") continue;

        let obj: any;
        try {
          obj = JSON.parse(payload);
        } catch {
          // Ignore unparseable protocol noise.
          continue;
        }
        linesParsed += 1;

        const t = String(obj?.type ?? "");
        if (t === "tool-input-available" && typeof obj.toolName === "string") {
          inc(toolCalls, obj.toolName);
        } else if (t === "text-delta" && typeof obj.delta === "string") {
          textChars += obj.delta.length;
          if (textPreview.length < 2000) {
            textPreview += obj.delta.slice(0, 2000 - textPreview.length);
          }
        } else if (t === "finish" && typeof obj.finishReason === "string") {
          finishReason = obj.finishReason;
        }

        // Safety: don't hang forever if the server misbehaves.
        if (linesParsed > 20000) break;
      }
      if (linesParsed > 20000) break;
    }
  } finally {
    reader.releaseLock();
  }

  console.log(
    JSON.stringify(
      {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get("content-type"),
        rawChars,
        linesParsed,
        textChars,
        textPreview: textPreview.trim().slice(0, 600),
        toolCalls,
        finishReason,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
