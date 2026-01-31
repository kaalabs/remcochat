import { isAdminEnabled } from "@/server/admin";
import { updateProviderDefaultModelInConfigToml } from "@/server/models-admin-config";
import { z } from "zod";

const BodySchema = z.object({
  providerId: z.string().min(1),
  defaultModelId: z.string().min(1),
});

export async function PUT(req: Request) {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body. Expected { providerId: string, defaultModelId: string }." },
      { status: 400 }
    );
  }

  try {
    await updateProviderDefaultModelInConfigToml(parsed.data);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update default model." },
      { status: 400 }
    );
  }
}

