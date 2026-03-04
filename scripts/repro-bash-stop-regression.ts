import { POST } from "../src/app/api/chat/route";

type ToolCount = Record<string, number>;
function inc(map: ToolCount, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

async function main() {
  const prompt =
    'Use the bash tool to run this command: `echo hello`.\n' +
    "Then tell me what it printed (1 short sentence).";

  const body = {
    profileId: "GzvrFppF-My437r9ReIxb",
    temporary: true,
    temporarySessionId: "repro-bash-stop-regression",
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
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const res = await POST(req);
  if (!res.body) throw new Error("No response body.");

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = "";
  let linesParsed = 0;
  let rawChars = 0;
  let textChars = 0;
  let textPreview = "";
  let finishReason: string | null = null;
  const toolInputs: ToolCount = {};
  const toolOutputs: ToolCount = {};

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = typeof value === "string" ? value : decoder.decode(value, { stream: true });
      rawChars += chunk.length;
      buf += chunk;

      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;

        const payload = line.startsWith("data:") ? line.slice("data:".length).trim() : line;
        if (!payload || payload === "[DONE]") continue;

        let obj: any;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        linesParsed += 1;

        const t = String(obj?.type ?? "");
        if (t === "tool-input-available" && typeof obj.toolName === "string") {
          inc(toolInputs, obj.toolName);
        } else if (t === "tool-output-available" && typeof obj.toolCallId === "string") {
          // toolName isn't in output chunks; count by toolCallId association isn't trivial here.
          inc(toolOutputs, "available");
        } else if (t === "text-delta" && typeof obj.delta === "string") {
          textChars += obj.delta.length;
          if (textPreview.length < 800) {
            textPreview += obj.delta.slice(0, 800 - textPreview.length);
          }
        } else if (t === "finish" && typeof obj.finishReason === "string") {
          finishReason = obj.finishReason;
        }
      }
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
        toolInputs,
        toolOutputs,
        textChars,
        textPreview: textPreview.trim(),
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

