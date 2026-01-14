import { deleteProfile, listProfiles, updateProfile } from "@/server/profiles";

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

export async function DELETE(
  req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;

  if (!body?.confirm) {
    return Response.json(
      { error: "Missing confirmation." },
      { status: 400 }
    );
  }

  try {
    // Server-side guard against accidental requests.
    // Accept either typing the profile name exactly or the literal "DELETE".
    const profile = listProfiles().find((p) => p.id === profileId) ?? null;
    if (!profile) throw new Error("Profile not found.");
    if (body.confirm !== "DELETE" && body.confirm !== profile.name) {
      return Response.json(
        { error: "Confirmation did not match." },
        { status: 400 }
      );
    }

    deleteProfile(profileId);
    return Response.json({ ok: true, profiles: listProfiles() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete profile." },
      { status: 400 }
    );
  }
}
