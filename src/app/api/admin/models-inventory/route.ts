import { isAdminEnabled } from "@/server/admin";
import { getConfigFilePath } from "@/server/config";
import { buildModelsInventory } from "@/server/models-inventory";

export async function GET() {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const inventory = await buildModelsInventory();
    return Response.json(
      { ...inventory, configPath: getConfigFilePath() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Failed to load models inventory: ${err.message}`
            : "Failed to load models inventory.",
      },
      { status: 500 }
    );
  }
}

