import { getProfile } from "@/server/profiles";
import { listProfileNotes, runNoteAction, type NoteActionInput } from "@/server/notes";

const allowedActions = new Set<NoteActionInput["action"]>([
  "show",
  "create",
  "delete",
]);

export async function GET(
  req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  getProfile(profileId);
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  return Response.json({ notes: listProfileNotes(profileId, limit ?? 20) });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  getProfile(profileId);

  const body = (await req.json().catch(() => null)) as Partial<NoteActionInput> | null;
  if (!body || typeof body.action !== "string") {
    return Response.json({ error: "Missing note action." }, { status: 400 });
  }

  if (!allowedActions.has(body.action as NoteActionInput["action"])) {
    return Response.json({ error: "Unsupported note action." }, { status: 400 });
  }

  try {
    const output = runNoteAction(profileId, {
      action: body.action as NoteActionInput["action"],
      content: typeof body.content === "string" ? body.content : undefined,
      noteId: typeof body.noteId === "string" ? body.noteId : undefined,
      noteIndex:
        typeof body.noteIndex === "number" ? body.noteIndex : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
    });
    return Response.json(output);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update notes." },
      { status: 400 }
    );
  }
}
