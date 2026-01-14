import { createProfile, listProfiles } from "@/server/profiles";

export async function GET() {
  return Response.json({ profiles: listProfiles() });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string; defaultModelId?: string };

  if (!body.name) {
    return Response.json({ error: "Missing profile name." }, { status: 400 });
  }

  try {
    const profile = createProfile({
      name: body.name,
      defaultModelId: body.defaultModelId,
    });
    return Response.json({ profile }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create profile." },
      { status: 400 }
    );
  }
}

