import { isAdminEnabled } from "@/server/admin";
import { getConfig } from "@/server/config";
import { createHueGatewayTools } from "@/ai/hue-gateway-tools";
import { createOvNlTools } from "@/ai/ov-nl-tools";

type ToolPreflightStatus = "enabled" | "disabled" | "blocked";

function preflightHueGateway(req: Request): ToolPreflightStatus {
  const cfg = getConfig().hueGateway;
  if (!cfg || !cfg.enabled) return "disabled";
  return createHueGatewayTools({
    request: req,
    isTemporary: false,
    skillRelevant: true,
    chatId: "admin",
    turnUserMessageId: "readiness-preflight",
  }).enabled
    ? "enabled"
    : "blocked";
}

function preflightOvNlGateway(req: Request): ToolPreflightStatus {
  const cfg = getConfig().ovNl;
  if (!cfg || !cfg.enabled) return "disabled";
  return createOvNlTools({ request: req }).enabled ? "enabled" : "blocked";
}

export async function GET(req: Request) {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const config = getConfig();

  return Response.json(
    {
      webTools: { enabled: Boolean(config.webTools?.enabled) },
      tools: {
        hueGateway: preflightHueGateway(req),
        ovNlGateway: preflightOvNlGateway(req),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
