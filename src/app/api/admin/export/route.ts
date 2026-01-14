import { exportAllData, isAdminEnabled } from "@/server/admin";

export async function GET() {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const payload = exportAllData();
  return Response.json(payload, {
    headers: {
      "Content-Disposition": `attachment; filename="remcochat-backup-${payload.exportedAt}.json"`,
    },
  });
}

