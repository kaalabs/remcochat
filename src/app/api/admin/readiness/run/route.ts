import fs from "node:fs";
import { z } from "zod";
import { generateText } from "ai";
import { isAdminEnabled } from "@/server/admin";
import { getConfig } from "@/server/config";
import { getLanguageModelForProvider } from "@/server/llm-provider";
import { createProviderOptionsForWebTools } from "@/ai/provider-options";
import { getWebSearchProviderById } from "@/server/web-search/registry";
import { getSkillsRegistry } from "@/server/skills/runtime";
import { parseSkillMd } from "@/server/skills/skill-md";
import { detectToolDependenciesFromText, type ToolDependencyToken } from "@/server/readiness/detect";
import { createHueGatewayTools } from "@/ai/hue-gateway-tools";
import { createOvNlTools } from "@/ai/ov-nl-tools";

const BodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("llm_provider"), providerId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("web_search_provider"),
      providerId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("skill"), skillName: z.string().min(1) }).strict(),
]);

export type ReadinessRunResponse = {
  kind: "llm_provider" | "web_search_provider" | "skill";
  id: string;
  status: "passed" | "failed" | "disabled" | "blocked" | "not_applicable";
};

function sanitizeErrorForLogs(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  let out = message.trim() || "unknown_error";
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>");
  out = out.replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "sk-<redacted>");
  out = out.replace(/\b(api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=<redacted>");
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const ms = Math.max(1_000, Math.floor(timeoutMs));
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

function readUtf8Prefix(filePath: string, maxBytes: number): string {
  const limit = Math.max(1_000, Math.floor(maxBytes));
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("Not a file.");

  const toRead = Math.min(stat.size, limit);
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(toRead);
    const bytesRead = fs.readSync(fd, buf, 0, toRead, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function toolPreflightStatus(input: {
  req: Request;
  tool: ToolDependencyToken;
}): "enabled" | "disabled" | "blocked" {
  const config = getConfig();
  if (input.tool === "hueGateway") {
    const cfg = config.hueGateway;
    if (!cfg || !cfg.enabled) return "disabled";
    return createHueGatewayTools({
      request: input.req,
      isTemporary: false,
      skillRelevant: true,
      chatId: "admin",
      turnUserMessageId: "readiness-skill",
    }).enabled
      ? "enabled"
      : "blocked";
  }
  const cfg = config.ovNl;
  if (!cfg || !cfg.enabled) return "disabled";
  return createOvNlTools({ request: input.req }).enabled ? "enabled" : "blocked";
}

async function runHueGatewaySnapshot(req: Request): Promise<boolean> {
  const tools = createHueGatewayTools({
    request: req,
    isTemporary: false,
    skillRelevant: true,
    chatId: "admin",
    turnUserMessageId: "readiness-hue-snapshot",
  });
  if (!tools.enabled) return false;
  const hueGateway = (tools.tools as { hueGateway?: unknown }).hueGateway as
    | { execute?: (args: unknown) => Promise<unknown> }
    | undefined;
  if (!hueGateway?.execute) return false;
  const out = (await hueGateway.execute({
    action: "inventory.snapshot",
    args: {},
  })) as { ok?: unknown } | null;
  return Boolean(out && out.ok === true);
}

async function runOvNlStationsSearch(req: Request): Promise<boolean> {
  const tools = createOvNlTools({ request: req });
  if (!tools.enabled) return false;
  const ovNlGateway = (tools.tools as { ovNlGateway?: unknown }).ovNlGateway as
    | { execute?: (args: unknown) => Promise<unknown> }
    | undefined;
  if (!ovNlGateway?.execute) return false;
  const out = (await ovNlGateway.execute({
    action: "stations.search",
    args: { query: "Utrecht", limit: 1 },
  })) as { kind?: unknown } | null;
  return Boolean(out && out.kind !== "error");
}

export async function POST(req: Request) {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (parsed.data.kind === "llm_provider") {
    const providerId = parsed.data.providerId;
    const config = getConfig();
    const provider = config.providers.find((p) => p.id === providerId) ?? null;
    if (!provider) {
      const res: ReadinessRunResponse = {
        kind: "llm_provider",
        id: providerId,
        status: "failed",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }

    try {
      const resolved = await withTimeout(
        getLanguageModelForProvider(providerId, provider.defaultModelId),
        8_000
      );
      const providerOptions = createProviderOptionsForWebTools({
        modelType: resolved.modelType,
        providerModelId: resolved.providerModelId,
        webToolsEnabled: false,
        capabilities: resolved.capabilities,
        reasoning: config.reasoning,
      });
      await withTimeout(
        generateText({
          model: resolved.model,
          prompt: "ping",
          // OpenAI rejects very small values (e.g. requires >= 16); keep this small but valid.
          maxOutputTokens: 16,
          ...(resolved.capabilities.temperature && !resolved.capabilities.reasoning
            ? { temperature: 0 }
            : {}),
          ...(providerOptions ? { providerOptions } : {}),
        }),
        8_000
      );

      const res: ReadinessRunResponse = {
        kind: "llm_provider",
        id: providerId,
        status: "passed",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      // Server-side only: help debug false negatives without exposing details to the UI.
      try {
        // eslint-disable-next-line no-console
        console.error("readiness.llm_provider_failed", {
          providerId,
          error: sanitizeErrorForLogs(err),
        });
      } catch {
        // ignore logging failures
      }
      const res: ReadinessRunResponse = {
        kind: "llm_provider",
        id: providerId,
        status: "failed",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }
  }

  if (parsed.data.kind === "web_search_provider") {
    const providerId = parsed.data.providerId;
    const config = getConfig();

    if (!config.webTools?.enabled) {
      const res: ReadinessRunResponse = {
        kind: "web_search_provider",
        id: providerId,
        status: "disabled",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }

    const provider = getWebSearchProviderById(providerId);
    if (!provider) {
      const res: ReadinessRunResponse = {
        kind: "web_search_provider",
        id: providerId,
        status: "failed",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }

    try {
      await withTimeout(provider.smokeTest(), 6_000);
      const res: ReadinessRunResponse = {
        kind: "web_search_provider",
        id: providerId,
        status: "passed",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    } catch {
      const res: ReadinessRunResponse = {
        kind: "web_search_provider",
        id: providerId,
        status: "failed",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }
  }

  const skillName = parsed.data.skillName;
  const registry = getSkillsRegistry();
  if (!registry) {
    const res: ReadinessRunResponse = {
      kind: "skill",
      id: skillName,
      status: "disabled",
    };
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  }

  const record = registry.get(skillName);
  if (!record) {
    const res: ReadinessRunResponse = {
      kind: "skill",
      id: skillName,
      status: "failed",
    };
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const cfg = getConfig();
    const maxBytes = cfg.skills?.maxSkillMdBytes ?? 200_000;
    const content = readUtf8Prefix(record.skillMdPath, maxBytes);
    const deps = detectToolDependenciesFromText(content);
    if (deps.length === 0) {
      const res: ReadinessRunResponse = {
        kind: "skill",
        id: skillName,
        status: "not_applicable",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }

    const parsedMd = parseSkillMd(content);
    if (String(parsedMd.frontmatter.name ?? "").trim() !== record.name) {
      const res: ReadinessRunResponse = {
        kind: "skill",
        id: skillName,
        status: "failed",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }

    const preflight = deps.map((tool) => ({
      tool,
      status: toolPreflightStatus({ req, tool }),
    }));

    if (preflight.some((p) => p.status === "blocked")) {
      const res: ReadinessRunResponse = {
        kind: "skill",
        id: skillName,
        status: "blocked",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }
    if (preflight.some((p) => p.status === "disabled")) {
      const res: ReadinessRunResponse = {
        kind: "skill",
        id: skillName,
        status: "disabled",
      };
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }

    let failed = false;
    for (const dep of deps) {
      if (dep === "hueGateway") {
        const ok = await withTimeout(runHueGatewaySnapshot(req), 8_000);
        if (!ok) {
          failed = true;
          break;
        }
      } else {
        const ok = await withTimeout(runOvNlStationsSearch(req), 8_000);
        if (!ok) {
          failed = true;
          break;
        }
      }
    }

    const res: ReadinessRunResponse = {
      kind: "skill",
      id: skillName,
      status: failed ? "failed" : "passed",
    };
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch {
    const res: ReadinessRunResponse = {
      kind: "skill",
      id: skillName,
      status: "failed",
    };
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  }
}
