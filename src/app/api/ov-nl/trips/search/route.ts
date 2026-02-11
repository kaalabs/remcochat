import { createOvNlTools } from "@/ai/ov-nl-tools";
import type { OvNlToolOutput } from "@/lib/types";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  from: z.string().trim().min(1).max(120),
  to: z.string().trim().min(1).max(120),
  via: z.string().trim().min(1).max(120).optional(),
  dateTime: z.string().trim().min(1).max(64).optional(),
  searchForArrival: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  lang: z.string().trim().min(2).max(12).optional(),
  intent: z.unknown().optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body. Expected { from: string, to: string, ... }." },
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
    action: "trips.search",
    args: {
      from: parsed.data.from,
      to: parsed.data.to,
      ...(parsed.data.via ? { via: parsed.data.via } : {}),
      ...(parsed.data.dateTime ? { dateTime: parsed.data.dateTime } : {}),
      ...(typeof parsed.data.searchForArrival === "boolean"
        ? { searchForArrival: parsed.data.searchForArrival }
        : {}),
      ...(typeof parsed.data.limit === "number" ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.lang ? { lang: parsed.data.lang } : {}),
      ...(parsed.data.intent ? { intent: parsed.data.intent } : {}),
    },
  })) as OvNlToolOutput;

  return Response.json(output, { headers: { "Cache-Control": "no-store" } });
}

