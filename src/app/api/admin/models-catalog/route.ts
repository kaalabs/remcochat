import { isAdminEnabled } from "@/server/admin";
import { getModelsDevCatalog } from "@/server/modelsdev-catalog";

export async function GET() {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const catalog = await getModelsDevCatalog();
    return Response.json(catalog, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Failed to load models catalog: ${err.message}`
            : "Failed to load models catalog.",
      },
      { status: 500 }
    );
  }
}

