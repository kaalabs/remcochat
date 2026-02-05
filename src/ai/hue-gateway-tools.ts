import { tool as createTool } from "ai";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { getConfig } from "@/server/config";
import { isLocalhostRequest, isRequestAllowedByAdminPolicy } from "@/server/request-auth";
import { postHueGatewayV2Action } from "@/server/integrations/hue-gateway/v2/client";
import { createHueGatewayDeterministicIds } from "@/server/integrations/hue-gateway/v2/keys";

export type HueGatewayToolsResult = {
  enabled: boolean;
  tools: Record<string, unknown>;
};

const HueGatewayToolActionSchema = z.enum([
  "inventory.snapshot",
  "room.set",
  "zone.set",
  "light.set",
  "grouped_light.set",
  "scene.activate",
  "resolve.by_name",
  "clipv2.request",
  "actions.batch",
]);

const SAFE_MATCH_DEFAULTS = {
  mode: "normalized",
  minConfidence: 0.85,
  minGap: 0.15,
  maxCandidates: 10,
} as const;

const VERIFY_DEFAULTS_POLL = {
  mode: "poll",
  timeoutMs: 2000,
  pollIntervalMs: 150,
} as const;

const MatchOptionsSchema = z
  .object({
    mode: z.enum(["exact", "case_insensitive", "normalized", "fuzzy"]).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    minGap: z.number().min(0).max(1).optional(),
    maxCandidates: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const VerifyOptionsSchema = z
  .object({
    mode: z.enum(["none", "poll", "sse", "poll_then_sse"]).optional(),
    timeoutMs: z.number().int().min(0).optional(),
    pollIntervalMs: z.number().int().min(1).optional(),
    tolerances: z
      .object({
        brightness: z.number().min(0).optional(),
        colorTempK: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const XYColorSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

const LightStateSchema = z
  .object({
    on: z.boolean().optional(),
    brightness: z.number().min(0).max(100).optional(),
    colorTempK: z.number().int().min(1).optional(),
    xy: XYColorSchema.optional(),
  })
  .strict();

const InventorySnapshotArgsSchema = z
  .object({
    ifRevision: z.number().int().min(0).optional(),
  })
  .strict();

const ResolveByNameArgsSchema = z
  .object({
    rtype: z.string().min(1),
    name: z.string().min(1),
    match: MatchOptionsSchema.optional(),
  })
  .strict();

const ClipV2RequestArgsSchema = z
  .object({
    method: z.enum(["GET", "HEAD", "OPTIONS"]),
    path: z
      .string()
      .min(1)
      .regex(/^\/clip\/v2\/.*/)
      .refine((p) => !/:\/\//.test(p), "path must not contain scheme/host"),
    body: z.unknown().optional(),
    retry: z.boolean().optional(),
  })
  .strict();

const LightSetArgsSchema = z
  .object({
    rid: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    match: MatchOptionsSchema.optional(),
    state: LightStateSchema,
    verify: VerifyOptionsSchema.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.rid || v.name), "light.set requires rid or name");

const GroupedLightSetArgsSchema = z
  .object({
    rid: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    match: MatchOptionsSchema.optional(),
    state: LightStateSchema,
    verify: VerifyOptionsSchema.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.rid || v.name), "grouped_light.set requires rid or name");

const SceneActivateArgsSchema = z
  .object({
    rid: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    match: MatchOptionsSchema.optional(),
    verify: VerifyOptionsSchema.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.rid || v.name), "scene.activate requires rid or name");

const RoomSetArgsSchema = z
  .object({
    roomRid: z.string().min(1).optional(),
    roomName: z.string().min(1).optional(),
    match: MatchOptionsSchema.optional(),
    state: LightStateSchema,
    verify: VerifyOptionsSchema.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.roomRid || v.roomName), "room.set requires roomRid or roomName");

const ZoneSetArgsSchema = z
  .object({
    zoneRid: z.string().min(1).optional(),
    zoneName: z.string().min(1).optional(),
    dryRun: z.boolean().optional(),
    match: MatchOptionsSchema.optional(),
    state: LightStateSchema.optional(),
    verify: VerifyOptionsSchema.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.zoneRid || v.zoneName), "zone.set requires zoneRid or zoneName");

const BatchStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inventory.snapshot"), args: InventorySnapshotArgsSchema }).strict(),
  z.object({ action: z.literal("room.set"), args: RoomSetArgsSchema }).strict(),
  z.object({ action: z.literal("zone.set"), args: ZoneSetArgsSchema }).strict(),
  z.object({ action: z.literal("light.set"), args: LightSetArgsSchema }).strict(),
  z.object({ action: z.literal("grouped_light.set"), args: GroupedLightSetArgsSchema }).strict(),
  z.object({ action: z.literal("scene.activate"), args: SceneActivateArgsSchema }).strict(),
  z.object({ action: z.literal("resolve.by_name"), args: ResolveByNameArgsSchema }).strict(),
  z.object({ action: z.literal("clipv2.request"), args: ClipV2RequestArgsSchema }).strict(),
]);

const ActionsBatchArgsSchema = z
  .object({
    continueOnError: z.boolean().optional(),
    actions: z.array(BatchStepSchema).min(1),
  })
  .strict();

// NOTE: Several tool-calling providers require the top-level JSON Schema to have
// `type: "object"`. Zod discriminated unions can serialize to JSON Schema
// without a top-level type, which breaks those providers. We therefore expose a
// "wire" schema (simple object) for tool registration, and validate the full
// discriminated union ourselves inside `execute`.
const HueGatewayToolWireInputSchema = z
  .object({
    action: HueGatewayToolActionSchema,
    // Intentionally broad: providers require top-level `type:"object"` for tool schemas,
    // and the AI SDK forces `additionalProperties:false` on object schemas for
    // compatibility. We therefore validate the detailed discriminated union at runtime.
    args: z.unknown().optional(),
  })
  .strict();

const HueGatewayToolValidatedInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inventory.snapshot"), args: InventorySnapshotArgsSchema }).strict(),
  z.object({ action: z.literal("room.set"), args: RoomSetArgsSchema }).strict(),
  z.object({ action: z.literal("zone.set"), args: ZoneSetArgsSchema }).strict(),
  z.object({ action: z.literal("light.set"), args: LightSetArgsSchema }).strict(),
  z.object({ action: z.literal("grouped_light.set"), args: GroupedLightSetArgsSchema }).strict(),
  z.object({ action: z.literal("scene.activate"), args: SceneActivateArgsSchema }).strict(),
  z.object({ action: z.literal("resolve.by_name"), args: ResolveByNameArgsSchema }).strict(),
  z.object({ action: z.literal("clipv2.request"), args: ClipV2RequestArgsSchema }).strict(),
  z.object({ action: z.literal("actions.batch"), args: ActionsBatchArgsSchema }).strict(),
]);

function applySafeMatchDefaults(match: unknown | undefined): unknown {
  if (match && typeof match === "object") return match;
  return { ...SAFE_MATCH_DEFAULTS };
}

function applyVerifyDefaultForLowLevel(verify: unknown | undefined): unknown {
  if (verify && typeof verify === "object") return verify;
  return { mode: "none" };
}

function applyDefaults(action: string, args: any): any {
  if (!args || typeof args !== "object") return args;

  if (action === "resolve.by_name") {
    if (!args.match) args.match = applySafeMatchDefaults(args.match);
    return args;
  }

  if (action === "room.set") {
    if (args.roomName && !args.match) args.match = applySafeMatchDefaults(args.match);
    if (!args.verify) args.verify = { ...VERIFY_DEFAULTS_POLL };
    return args;
  }

  if (action === "zone.set") {
    if (args.zoneName && !args.match) args.match = applySafeMatchDefaults(args.match);
    if (args.dryRun !== true && !args.verify) args.verify = { ...VERIFY_DEFAULTS_POLL };
    return args;
  }

  if (action === "light.set" || action === "grouped_light.set") {
    if (args.name && !args.match) args.match = applySafeMatchDefaults(args.match);
    if (!args.verify) args.verify = applyVerifyDefaultForLowLevel(args.verify);
    return args;
  }

  if (action === "scene.activate") {
    if (args.name && !args.match) args.match = applySafeMatchDefaults(args.match);
    return args;
  }

  if (action === "actions.batch") {
    const actions = Array.isArray(args.actions) ? args.actions : [];
    args.actions = actions.map((step: any) => {
      const cloned = { ...step, args: step?.args ? structuredClone(step.args) : step.args };
      cloned.args = applyDefaults(String(cloned.action ?? ""), cloned.args);
      return cloned;
    });
    return args;
  }

  return args;
}

function isStateChanging(action: string, args: any): boolean {
  if (action === "inventory.snapshot") return false;
  if (action === "resolve.by_name") return false;
  if (action === "clipv2.request") return false;
  if (action === "zone.set") return args?.dryRun !== true;
  return true;
}

function extractRetryAfterMs(input: {
  headers: Headers;
  json: any;
}): number | null {
  const raw = input?.json?.error?.details?.retryAfterMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }

  const retryAfter = input.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  }

  return null;
}

function resolveAuthHeaderLine(cfg: NonNullable<ReturnType<typeof getConfig>["hueGateway"]>): string {
  const headerEnv = String(cfg.authHeaderEnv ?? "").trim();
  const bearerEnv = String(cfg.bearerTokenEnv ?? "").trim();
  const apiKeyEnv = String(cfg.apiKeyEnv ?? "").trim();

  const headerLine = headerEnv ? String(process.env[headerEnv] ?? "").trim() : "";
  if (headerLine) return headerLine;

  const apiKey = apiKeyEnv ? String(process.env[apiKeyEnv] ?? "").trim() : "";
  if (apiKey) return `X-API-Key: ${apiKey}`;

  const bearerToken = bearerEnv ? String(process.env[bearerEnv] ?? "").trim() : "";
  if (bearerToken) return `Authorization: Bearer ${bearerToken}`;

  if (String(process.env.NODE_ENV ?? "").trim().toLowerCase() !== "production") {
    return "Authorization: Bearer dev-token";
  }

  throw new Error(
    `Hue Gateway auth is not configured. Set ${headerEnv} (full header), or ${apiKeyEnv}, or ${bearerEnv}.`
  );
}

export function createHueGatewayTools(input: {
  request: Request;
  isTemporary: boolean;
  skillRelevant: boolean;
  chatId?: string;
  temporarySessionId?: string;
  turnUserMessageId?: string;
}): HueGatewayToolsResult {
  const cfg = getConfig().hueGateway;
  if (!cfg || !cfg.enabled) return { enabled: false, tools: {} };
  if (!input.skillRelevant) return { enabled: false, tools: {} };

  if (cfg.access === "localhost" && !isLocalhostRequest(input.request)) {
    return { enabled: false, tools: {} };
  }
  if (cfg.access === "lan" && !isRequestAllowedByAdminPolicy(input.request)) {
    return { enabled: false, tools: {} };
  }

  const hueGateway = createTool({
    description:
      "Execute a Hue Gateway API v2 action via POST /v2/actions with deterministic correlation/idempotency keys and safe defaults (match/verify).",
    inputSchema: HueGatewayToolWireInputSchema,
    execute: async (toolInput) => {
      const turnUserMessageId = String(input.turnUserMessageId ?? "").trim() || "unknown";
      const turnKey = input.isTemporary
        ? `${String(input.temporarySessionId ?? "").trim() || "tmp"}:${turnUserMessageId}`
        : `${String(input.chatId ?? "").trim() || "chat"}:${turnUserMessageId}`;

      const action = String((toolInput as any).action ?? "").trim();
      const argsRaw = (toolInput as any).args ?? {};
      const args = applyDefaults(action, structuredClone(argsRaw));

      const ids = createHueGatewayDeterministicIds({ turnKey, action, args });
      const requestId = ids.requestId;

      const validated = HueGatewayToolValidatedInputSchema.safeParse({ action, args });
      if (!validated.success) {
        return {
          status: 0,
          ok: false,
          action,
          requestId,
          error: {
            code: "invalid_tool_input",
            message: "Invalid hueGateway tool input.",
            details: { issues: validated.error.issues },
          },
        };
      }

      const validatedArgs = validated.data.args;
      const stateChanging = isStateChanging(action, validatedArgs);
      const idempotencyKey = stateChanging ? ids.idempotencyKey : undefined;

      const authHeaderLine = resolveAuthHeaderLine(cfg);
      const body: Record<string, unknown> = { requestId, action, args: validatedArgs };
      if (idempotencyKey) body.idempotencyKey = idempotencyKey;

      const sendOnce = async () => {
        const res = await postHueGatewayV2Action({
          baseUrls: cfg.baseUrls,
          timeoutMs: cfg.timeoutMs,
          authHeaderLine,
          requestId,
          idempotencyKey,
          body,
        });
        if (!res.ok) {
          return {
            status: 0,
            ok: false,
            action,
            requestId,
            error: res.error,
          };
        }

        let json: any;
        try {
          json = JSON.parse(res.text);
        } catch {
          throw new Error("Hue Gateway returned a non-JSON response.");
        }

        const retryAfterMs = extractRetryAfterMs({ headers: res.headers, json });
        const ok = json?.ok === true;
        return ok
          ? {
              status: res.status,
              ok: true,
              action,
              requestId,
              result: json?.result ?? null,
            }
          : {
              status: res.status,
              ok: false,
              action,
              requestId,
              error: json?.error ?? {
                code: "internal_error",
                message: "Unknown error from Hue Gateway.",
                details: {},
              },
              ...(retryAfterMs != null ? { retryAfterMs } : {}),
            };
      };

      const first = await sendOnce();
      if (first.ok) return first;

      const errorCode = String((first as any).error?.code ?? "").trim();
      const shouldRetry =
        (first.status === 409 && errorCode === "idempotency_in_progress") ||
        (first.status === 429 && (errorCode === "rate_limited" || errorCode === "bridge_rate_limited"));

      if (!shouldRetry) return first;

      const retryAfterMs = typeof (first as any).retryAfterMs === "number" ? (first as any).retryAfterMs : null;
      const waitMs = Math.min(1_000, Math.max(0, retryAfterMs ?? 250));
      if (waitMs > 0) await delay(waitMs);

      return sendOnce();
    },
  });

  return { enabled: true, tools: { hueGateway } };
}
