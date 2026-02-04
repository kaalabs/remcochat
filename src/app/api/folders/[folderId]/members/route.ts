import { listFolderMembers } from "@/server/folders";

export async function GET(
  req: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  const { folderId } = await context.params;
  const url = new URL(req.url);
  const profileId = url.searchParams.get("profileId");
  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    return Response.json({ members: listFolderMembers(profileId, folderId) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list members." },
      { status: 400 }
    );
  }
}

