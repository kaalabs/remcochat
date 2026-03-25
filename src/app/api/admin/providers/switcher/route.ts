import { isAdminEnabled } from "@/server/admin";
import { buildProviderSwitcher } from "@/server/provider-switching";

export async function GET() {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const switcher = await buildProviderSwitcher();
    return Response.json(switcher, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Failed to load provider switcher: ${err.message}`
            : "Failed to load provider switcher.",
      },
      { status: 500 },
    );
  }
}
