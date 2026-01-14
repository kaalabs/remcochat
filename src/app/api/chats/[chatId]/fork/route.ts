import { forkChatFromUserMessage } from "@/server/chats";

export async function POST(
  req: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await context.params;
  const body = (await req.json()) as {
    profileId?: string;
    userMessageId?: string;
    text?: string;
  };

  if (!body.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }
  if (!body.userMessageId) {
    return Response.json({ error: "Missing userMessageId." }, { status: 400 });
  }
  if (typeof body.text !== "string") {
    return Response.json({ error: "Missing text." }, { status: 400 });
  }

  try {
    const chat = forkChatFromUserMessage({
      profileId: body.profileId,
      chatId,
      userMessageId: body.userMessageId,
      text: body.text,
    });
    return Response.json({ chat }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to fork chat." },
      { status: 400 }
    );
  }
}

