import { archiveChat, getChatForViewer, unarchiveChat } from "@/server/chats";

export async function POST(
  req: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await context.params;
  const body = (await req.json().catch(() => null)) as { profileId?: string } | null;
  if (!body?.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    archiveChat(body.profileId, chatId);
    const chat = getChatForViewer(body.profileId, chatId);
    return Response.json({ chat });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to archive chat." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await context.params;
  const body = (await req.json().catch(() => null)) as { profileId?: string } | null;
  if (!body?.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    unarchiveChat(body.profileId, chatId);
    const chat = getChatForViewer(body.profileId, chatId);
    return Response.json({ chat });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to unarchive chat." },
      { status: 400 }
    );
  }
}
