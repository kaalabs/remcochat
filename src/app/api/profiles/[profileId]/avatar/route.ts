import { getProfile } from "@/server/profiles";
import {
  deleteProfileAvatar,
  readProfileAvatarFile,
  setProfileAvatar,
  updateProfileAvatarPosition,
} from "@/server/profile-avatars";

export const runtime = "nodejs";

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 50;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  try {
    const { bytes, mediaType, updatedAt } = await readProfileAvatarFile(profileId);
    const body: Uint8Array<ArrayBuffer> = Uint8Array.from(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": mediaType,
        "cache-control": "no-store",
        etag: `W/"${encodeURIComponent(updatedAt)}"`,
      },
    });
  } catch {
    return new Response("Not found.", { status: 404 });
  }
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing file." }, { status: 400 });
    }

    const posX = clampPct(Number(form.get("posX")));
    const posY = clampPct(Number(form.get("posY")));

    const bytes = Buffer.from(await file.arrayBuffer());
    await setProfileAvatar(profileId, {
      bytes,
      mediaType: file.type,
      position: { x: posX, y: posY },
    });

    return Response.json({ profile: getProfile(profileId) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to upload avatar." },
      { status: 400 }
    );
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  const body = (await req.json().catch(() => null)) as
    | { posX?: unknown; posY?: unknown }
    | null;
  try {
    const posX = clampPct(Number(body?.posX));
    const posY = clampPct(Number(body?.posY));
    updateProfileAvatarPosition(profileId, { x: posX, y: posY });
    return Response.json({ profile: getProfile(profileId) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update avatar." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  try {
    await deleteProfileAvatar(profileId);
    return Response.json({ profile: getProfile(profileId) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete avatar." },
      { status: 400 }
    );
  }
}
