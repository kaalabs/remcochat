import { isAdminEnabled } from "@/server/admin";
import { updateRouterModelInConfigToml } from "@/server/models-admin-config";
import { z } from "zod";

const BodySchema = z.object({
  modelId: z.string().min(1),
});

export async function PUT(req: Request) {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body. Expected { modelId: string }." }, { status: 400 });
  }

  try {
    await updateRouterModelInConfigToml(parsed.data);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update router model." },
      { status: 400 }
    );
  }
}

