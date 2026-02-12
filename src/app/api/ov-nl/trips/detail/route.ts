import { createOvNlTools } from "@/ai/ov-nl-tools";
import { OV_NL_CTX_RECON_MAX_LEN } from "@/lib/ov-nl-constants";
import type { OvNlToolOutput } from "@/lib/types";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  ctxRecon: z.string().trim().min(1).max(OV_NL_CTX_RECON_MAX_LEN),
  date: z.string().trim().min(1).max(64).optional(),
  lang: z.string().trim().min(2).max(12).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid body. Expected { ctxRecon: string, date?: string, lang?: string }.' },
      { status: 400 }
    );
  }

  const { enabled, tools } = createOvNlTools({ request: req });
  if (!enabled) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const maybeTool = (tools as Record<string, unknown>).ovNlGateway;
  const ovNlGateway =
    maybeTool && typeof maybeTool === "object" && !Array.isArray(maybeTool)
      ? (maybeTool as { execute?: (input: unknown) => Promise<unknown> })
      : null;
  if (!ovNlGateway?.execute) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const output = (await ovNlGateway.execute({
    action: "trips.detail",
    args: {
      ctxRecon: parsed.data.ctxRecon,
      ...(parsed.data.date ? { date: parsed.data.date } : {}),
      ...(parsed.data.lang ? { lang: parsed.data.lang } : {}),
    },
  })) as OvNlToolOutput;

  return Response.json(output, { headers: { "Cache-Control": "no-store" } });
}
