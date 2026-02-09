import { detectUiLanguageFromAcceptLanguage, parseUiLanguage } from "@/lib/i18n";
import { createProfile, listProfiles } from "@/server/profiles";
import { headers } from "next/headers";

export async function GET() {
  const headerStore = await headers();
  const seedUiLanguage = detectUiLanguageFromAcceptLanguage(
    headerStore.get("accept-language")
  );
  return Response.json({ profiles: listProfiles({ seedUiLanguage }) });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name?: string;
    defaultModelId?: string;
    uiLanguage?: string;
  };

  if (!body.name) {
    return Response.json({ error: "Missing profile name." }, { status: 400 });
  }

  try {
    const uiLanguage = parseUiLanguage(body.uiLanguage) ?? "nl";
    const profile = createProfile({
      name: body.name,
      defaultModelId: body.defaultModelId,
      uiLanguage,
    });
    return Response.json({ profile }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create profile." },
      { status: 400 }
    );
  }
}
