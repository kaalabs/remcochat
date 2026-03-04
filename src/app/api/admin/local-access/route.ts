import fs from "node:fs";
import TOML from "@iarna/toml";
import { z } from "zod";
import { isAdminEnabled } from "@/server/admin";
import { getConfigFilePath } from "@/server/config";
import { updateLocalAccessInConfigToml } from "@/server/local-access-admin-config";

function tomlToPlainObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => tomlToPlainObject(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = tomlToPlainObject(inner);
    }
    return out;
  }
  return value;
}

function readLocalAccessFromConfigToml(content: string): {
  configured: boolean;
  enabled: boolean;
  allowedCommands: string[];
  allowedDirectories: string[];
} {
  const parsed = TOML.parse(content);
  const raw = tomlToPlainObject(parsed) as Record<string, unknown>;
  const app = (raw.app && typeof raw.app === "object" ? raw.app : {}) as Record<string, unknown>;
  const configured = Object.prototype.hasOwnProperty.call(app, "local_access");
  const local =
    app.local_access && typeof app.local_access === "object" ? (app.local_access as Record<string, unknown>) : {};

  const enabled = Boolean(local.enabled ?? false);
  const allowedCommands = Array.isArray(local.allowed_commands)
    ? local.allowed_commands.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const allowedDirectories = Array.isArray(local.allowed_directories)
    ? local.allowed_directories.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];

  return { configured, enabled, allowedCommands, allowedDirectories };
}

const PutBodySchema = z.object({
  enabled: z.boolean(),
  allowedCommands: z.array(z.string()).default([]),
  allowedDirectories: z.array(z.string()).default([]),
});

export async function GET() {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const filePath = getConfigFilePath();
    const content = fs.readFileSync(filePath, "utf8");
    const localAccess = readLocalAccessFromConfigToml(content);
    return Response.json(localAccess, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read config.toml." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PUT(req: Request) {
  if (!isAdminEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = PutBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      {
        error:
          "Invalid body. Expected { enabled: boolean, allowedCommands: string[], allowedDirectories: string[] }.",
      },
      { status: 400 }
    );
  }

  try {
    await updateLocalAccessInConfigToml(parsed.data);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Failed to update local access policy.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

