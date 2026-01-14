import { exportChatMarkdown, exportChatSnapshot } from "@/server/chats";

function sanitizeFilenamePart(input: string) {
  const trimmed = input.trim() || "chat";
  return trimmed
    .replace(/[^\w\s.-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await context.params;
  const url = new URL(req.url);
  const profileId = url.searchParams.get("profileId") ?? "";
  const format = (url.searchParams.get("format") ?? "md").toLowerCase();

  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    if (format === "json") {
      const snapshot = exportChatSnapshot(profileId, chatId);
      return Response.json(snapshot, {
        headers: {
          "Content-Disposition": `attachment; filename="remcochat-${chatId}.json"`,
        },
      });
    }

    const { markdown, title } = exportChatMarkdown(profileId, chatId);
    const filename = `${sanitizeFilenamePart(title)}.md`;
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to export chat." },
      { status: 400 }
    );
  }
}

