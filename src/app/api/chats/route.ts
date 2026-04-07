import { createChat, getChatForViewer, listAccessibleChats } from "@/server/chats";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const profileId = url.searchParams.get("profileId");
  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }
  return Response.json({ chats: listAccessibleChats(profileId) });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    profileId?: string;
    modelId?: string;
    title?: string;
  };

  if (!body.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    const created = createChat({
      profileId: body.profileId,
      modelId: body.modelId,
      title: body.title,
    });
    const chat = getChatForViewer(body.profileId, created.id);
    return Response.json({ chat }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create chat." },
      { status: 400 }
    );
  }
}
