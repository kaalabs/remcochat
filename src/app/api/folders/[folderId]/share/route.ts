import { shareFolder } from "@/server/folders";

export async function POST(
  req: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  const { folderId } = await context.params;
  const body = (await req.json().catch(() => null)) as
    | { profileId?: string; targetProfile?: string }
    | null;

  if (!body?.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }
  if (!body.targetProfile) {
    return Response.json({ error: "Missing targetProfile." }, { status: 400 });
  }

  try {
    shareFolder(body.profileId, folderId, { targetProfile: body.targetProfile });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to share folder." },
      { status: 400 }
    );
  }
}

