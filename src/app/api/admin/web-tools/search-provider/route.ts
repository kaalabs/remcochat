import { isAdminEnabled } from "@/server/admin";
import { getConfig } from "@/server/config";
import { updateWebToolsSearchProviderInConfigToml } from "@/server/models-admin-config";
import { z } from "zod";

const BodySchema = z.object({
  searchProvider: z.enum(["exa", "brave"]),
});

export async function GET() {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const config = getConfig();
  return Response.json(
    {
      enabled: Boolean(config.webTools?.enabled),
      searchProvider: config.webTools?.searchProvider ?? "exa",
      hasExaKey: Boolean(String(process.env.EXA_API_KEY ?? "").trim()),
      hasBraveKey: Boolean(String(process.env.BRAVE_SEARCH_API ?? "").trim()),
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
      { error: 'Invalid body. Expected { searchProvider: "exa" | "brave" }.' },
      { status: 400 }
    );
  }

  try {
    await updateWebToolsSearchProviderInConfigToml({
      searchProvider: parsed.data.searchProvider,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update web search provider." },
      { status: 400 }
    );
  }
}
