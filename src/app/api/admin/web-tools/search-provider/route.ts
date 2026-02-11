import { isAdminEnabled } from "@/server/admin";
import { getConfig } from "@/server/config";
import { updateWebToolsSearchProviderInConfigToml } from "@/server/models-admin-config";
import { listWebSearchProviders, getWebSearchProviderById } from "@/server/web-search/registry";
import { z } from "zod";

const BodySchema = z.object({
  providerId: z.string().min(1),
});

export async function GET() {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const config = getConfig();
  const providers = listWebSearchProviders().map((p) => ({ id: p.id, label: p.label }));
  return Response.json(
    {
      enabled: Boolean(config.webTools?.enabled),
      selectedProviderId: config.webTools?.searchProvider ?? (providers[0]?.id ?? "exa"),
      providers,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(req: Request) {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid body. Expected { providerId: "<id>" }.' },
      { status: 400 }
    );
  }

  try {
    const provider = getWebSearchProviderById(parsed.data.providerId);
    if (!provider) {
      return Response.json(
        { error: "Unknown web search provider." },
        { status: 400 }
      );
    }
    await updateWebToolsSearchProviderInConfigToml({
      // config currently supports exa/brave; registry validation ensures safety here.
      searchProvider: provider.id as "exa" | "brave",
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update web search provider." },
      { status: 400 }
    );
  }
}
