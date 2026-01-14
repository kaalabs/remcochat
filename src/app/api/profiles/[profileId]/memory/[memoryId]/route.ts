import { deleteMemoryItem } from "@/server/memory";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ profileId: string; memoryId: string }> }
) {
  const { profileId, memoryId } = await context.params;

  try {
    deleteMemoryItem(profileId, memoryId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete memory." },
      { status: 400 }
    );
  }
}

