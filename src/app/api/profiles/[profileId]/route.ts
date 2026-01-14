import { updateProfile } from "@/server/profiles";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  const body = (await req.json()) as {
    name?: string;
    defaultModelId?: string;
    customInstructions?: string;
    memoryEnabled?: boolean;
  };

  try {
    const profile = updateProfile(profileId, {
      name: body.name,
      defaultModelId: body.defaultModelId,
      customInstructions: body.customInstructions,
      memoryEnabled: body.memoryEnabled,
    });
    return Response.json({ profile });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update profile." },
      { status: 400 }
    );
  }
}

