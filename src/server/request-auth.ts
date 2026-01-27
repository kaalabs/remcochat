function hostnameFromHostHeader(host: string): string {
  const trimmed = String(host ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end > 0) return trimmed.slice(0, end + 1);
  }
  return trimmed.split(":")[0] ?? "";
}

export function isLocalhostRequest(req: Request): boolean {
  const hostHeader = req.headers.get("host") ?? "";
  const host = hostnameFromHostHeader(hostHeader).toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim().toLowerCase();
    if (first === "127.0.0.1" || first === "::1") return true;
  }
  const realIp = req.headers.get("x-real-ip")?.trim().toLowerCase();
  if (realIp === "127.0.0.1" || realIp === "::1") return true;

  return false;
}

export function adminTokenFromRequest(req: Request): string | null {
  const direct = req.headers.get("x-remcochat-admin-token");
  if (direct && direct.trim()) return direct.trim();

  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();
  return null;
}

export function isRequestAllowedByAdminPolicy(req: Request): boolean {
  if (isLocalhostRequest(req)) return true;
  const required = String(process.env.REMCOCHAT_ADMIN_TOKEN ?? "").trim();
  if (!required) return false;
  const provided = adminTokenFromRequest(req);
  return Boolean(provided && provided === required);
}

