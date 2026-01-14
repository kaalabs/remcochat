import { createMemoryItem, listProfileMemory } from "@/server/memory";

export async function GET(
  _req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  return Response.json({ memory: listProfileMemory(profileId) });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  const body = (await req.json()) as { content?: string };

  if (typeof body.content !== "string") {
    return Response.json({ error: "Missing content." }, { status: 400 });
  }

  try {
    const item = createMemoryItem({ profileId, content: body.content });
    return Response.json({ item }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save memory." },
      { status: 400 }
    );
  }
}

