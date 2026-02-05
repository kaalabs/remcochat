import crypto from "node:crypto";

function stableNormalize(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : stableNormalize(v)));
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = stableNormalize(v);
    }
    return out;
  }

  return null;
}

export function stableStringifyForHash(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createHueGatewayDeterministicIds(input: {
  turnKey: string;
  action: string;
  args: unknown;
}): { requestId: string; idempotencyKey: string; hashHex: string; hashShort: string } {
  const turnKey = String(input.turnKey ?? "").trim() || "unknown";
  const action = String(input.action ?? "").trim() || "unknown";

  const payload = { action, args: input.args ?? null };
  const hashHex = sha256Hex(stableStringifyForHash(payload));
  const hashShort = hashHex.slice(0, 24);

  return {
    requestId: `rc:req:${turnKey}:${hashShort}`,
    idempotencyKey: `rc:idem:${turnKey}:${hashShort}`,
    hashHex,
    hashShort,
  };
}

