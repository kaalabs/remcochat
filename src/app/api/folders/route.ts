import { createFolder, listAccessibleFolders } from "@/server/folders";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const profileId = url.searchParams.get("profileId");
  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }
  return Response.json({ folders: listAccessibleFolders(profileId) });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { profileId?: string; name?: string };
  if (!body.profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    const folder = createFolder(body.profileId, { name: String(body.name ?? "") });
    return Response.json({ folder }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create folder." },
      { status: 400 }
    );
  }
}
