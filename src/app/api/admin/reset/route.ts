import { isAdminEnabled, resetAllData } from "@/server/admin";

export async function POST(req: Request) {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    | { confirm?: string }
    | null;

  if (body?.confirm !== "RESET") {
    return Response.json(
      {
        error:
          "Reset requires JSON body { \"confirm\": \"RESET\" } to avoid accidental wipes.",
      },
      { status: 400 }
    );
  }

  resetAllData();
  return Response.json({ ok: true });
}

