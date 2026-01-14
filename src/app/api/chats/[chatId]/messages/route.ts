import { loadChatState, saveChatState } from "@/server/chats";
import type { UIMessage } from "ai";
import type { RemcoChatMessageMetadata } from "@/lib/types";

export async function GET(
  _req: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await context.params;
  return Response.json(loadChatState(chatId));
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await context.params;
  const body = (await req.json()) as {
    profileId?: string;
    messages?: UIMessage<RemcoChatMessageMetadata>[];
    variantsByUserMessageId?: Record<string, UIMessage<RemcoChatMessageMetadata>[]>;
  };

  if (!body.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "Missing messages." }, { status: 400 });
  }

  try {
    saveChatState({
      chatId,
      profileId: body.profileId,
      messages: body.messages,
      variantsByUserMessageId: body.variantsByUserMessageId,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save messages." },
      { status: 400 }
    );
  }
}
