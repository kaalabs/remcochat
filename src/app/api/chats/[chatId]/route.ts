import { deleteChat, updateChatForProfile } from "@/server/chats";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await context.params;
  const body = (await req.json()) as {
    profileId?: string;
    title?: string;
    modelId?: string;
    chatInstructions?: string;
    folderId?: string | null;
  };

  try {
    if (!body.profileId) {
      return Response.json({ error: "Missing profileId." }, { status: 400 });
    }

    const chat = updateChatForProfile(body.profileId, chatId, {
      title: body.title,
      modelId: body.modelId,
      chatInstructions: body.chatInstructions,
      folderId: body.folderId,
    });
    return Response.json({ chat });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update chat." },
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
    await deleteChat(body.profileId, chatId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete chat." },
      { status: 400 }
    );
  }
}
