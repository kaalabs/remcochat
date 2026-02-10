import { parseUiLanguage } from "@/lib/i18n";
import { getOpeningMessage } from "@/server/opening-message";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = parseUiLanguage(url.searchParams.get("lang"));

  if (!lang) {
    return Response.json(
      { error: "Invalid or missing lang. Use lang=en or lang=nl." },
      {
        status: 400,
        headers: { "cache-control": "no-store" },
      }
    );
  }

  const excludeCsv = String(url.searchParams.get("exclude") ?? "");
  const exclude = excludeCsv
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  try {
    const result = await getOpeningMessage({ lang, exclude });
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Failed to load opening message." },
      {
        status: 500,
        headers: { "cache-control": "no-store" },
      }
    );
  }
}
