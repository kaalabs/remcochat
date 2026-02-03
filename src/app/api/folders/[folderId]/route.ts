import { deleteFolder, updateFolder } from "@/server/folders";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  const { folderId } = await context.params;
  const body = (await req.json().catch(() => null)) as
    | {
        profileId?: string;
        name?: string;
        collapsed?: boolean;
      }
    | null;

  if (!body?.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    const folder = updateFolder(body.profileId, folderId, {
      name: body.name,
      collapsed: body.collapsed,
    });
    return Response.json({ folder });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update folder." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  const { folderId } = await context.params;
  const body = (await req.json().catch(() => null)) as { profileId?: string } | null;

  if (!body?.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    deleteFolder(body.profileId, folderId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete folder." },
      { status: 400 }
    );
  }
}
