import { archiveChat, unarchiveChat } from "@/server/chats";

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
    const chat = archiveChat(body.profileId, chatId);
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
    const chat = unarchiveChat(body.profileId, chatId);
    return Response.json({ chat });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to unarchive chat." },
      { status: 400 }
    );
  }
}

