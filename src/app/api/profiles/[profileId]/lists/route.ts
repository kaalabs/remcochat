import { getProfile } from "@/server/profiles";
import { listProfileLists, runListAction, type ListActionInput } from "@/server/lists";

const allowedActions = new Set<ListActionInput["action"]>([
  "show",
  "create",
  "add_items",
  "toggle_items",
  "remove_items",
  "clear_completed",
  "rename_list",
  "delete_list",
  "share_list",
  "unshare_list",
]);

export async function GET(
  _req: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await context.params;
  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  getProfile(profileId);
  return Response.json({ lists: listProfileLists(profileId) });
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

  const body = (await req.json().catch(() => null)) as Partial<ListActionInput> | null;
  if (!body || typeof body.action !== "string") {
    return Response.json({ error: "Missing list action." }, { status: 400 });
  }

  if (!allowedActions.has(body.action as ListActionInput["action"])) {
    return Response.json({ error: "Unsupported list action." }, { status: 400 });
  }

  try {
    const list = runListAction(profileId, {
      action: body.action as ListActionInput["action"],
      listId: typeof body.listId === "string" ? body.listId : undefined,
      listName: typeof body.listName === "string" ? body.listName : undefined,
      listKind: typeof body.listKind === "string" ? body.listKind : undefined,
      listOwner: typeof body.listOwner === "string" ? body.listOwner : undefined,
      items: Array.isArray(body.items) ? body.items.map(String) : undefined,
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.map(String) : undefined,
      newName: typeof body.newName === "string" ? body.newName : undefined,
      targetProfile:
        typeof body.targetProfile === "string" ? body.targetProfile : undefined,
    });
    return Response.json({ list });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update list." },
      { status: 400 }
    );
  }
}
