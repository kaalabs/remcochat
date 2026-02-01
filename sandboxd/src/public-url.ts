function hostnameFromHostHeader(host: string): string {
  const trimmed = String(host ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end > 0) return trimmed.slice(0, end + 1);
  }
  return trimmed.split(":")[0] ?? "";
}

export function buildPublishedPortUrl(input: {
  hostHeader: string | null;
  bindHost: string;
  publishedPortHostIp: string;
  hostPort: number;
  publicHost?: string | null;
  publicProto?: string | null;
}): string {
  const protoRaw = String(input.publicProto ?? "").trim().toLowerCase();
  const proto = protoRaw === "https" ? "https" : "http";

  const publicHost = String(input.publicHost ?? "").trim();
  if (publicHost) {
    return `${proto}://${publicHost}:${input.hostPort}`;
  }

  const publishHostIp = String(input.publishedPortHostIp ?? "").trim();
  // If we're binding to a single interface, that is the right host to hand to clients.
  if (publishHostIp && publishHostIp !== "0.0.0.0") {
    return `${proto}://${publishHostIp}:${input.hostPort}`;
  }

  // Fallbacks for 0.0.0.0 (bind-all): use the request Host header if present, otherwise bindHost.
  const reqHost = input.hostHeader ? hostnameFromHostHeader(input.hostHeader) : "";
  const hostname = reqHost || String(input.bindHost ?? "").trim() || "127.0.0.1";
  return `${proto}://${hostname}:${input.hostPort}`;
}

