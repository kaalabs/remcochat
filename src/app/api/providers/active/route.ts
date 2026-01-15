import { getConfig } from "@/server/config";
import { setActiveProviderIdInDb } from "@/server/app-settings";
import { z } from "zod";

const BodySchema = z.object({
  providerId: z.string().min(1),
});

export async function PUT(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body. Expected { providerId: string }." },
      { status: 400 }
    );
  }

  const config = getConfig();
  const providerId = parsed.data.providerId;

  const exists = config.providers.some((p) => p.id === providerId);
  if (!exists) {
    return Response.json(
      { error: `Unknown providerId: ${providerId}` },
      { status: 400 }
    );
  }

  setActiveProviderIdInDb(providerId);
  return Response.json({ ok: true, activeProviderId: providerId });
}

