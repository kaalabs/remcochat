import { adminTokenFromRequest, isLocalhostRequest } from "@/server/request-auth";

export type AdminAccessResponse = {
  isLocalhost: boolean;
  requiredConfigured: boolean;
  tokenProvided: boolean;
  allowed: boolean;
  reason:
    | "localhost"
    | "allowed"
    | "missing_server_token"
    | "missing_client_token"
    | "token_mismatch";
};

function checkAdminAccess(req: Request): AdminAccessResponse {
  const isLocalhost = isLocalhostRequest(req);
  const required = String(process.env.REMCOCHAT_ADMIN_TOKEN ?? "").trim();
  const provided = String(adminTokenFromRequest(req) ?? "").trim();

  if (isLocalhost) {
    return {
      isLocalhost: true,
      requiredConfigured: Boolean(required),
      tokenProvided: Boolean(provided),
      allowed: true,
      reason: "localhost",
    };
  }

  if (!required) {
    return {
      isLocalhost: false,
      requiredConfigured: false,
      tokenProvided: Boolean(provided),
      allowed: false,
      reason: "missing_server_token",
    };
  }

  if (!provided) {
    return {
      isLocalhost: false,
      requiredConfigured: true,
      tokenProvided: false,
      allowed: false,
      reason: "missing_client_token",
    };
  }

  if (provided !== required) {
    return {
      isLocalhost: false,
      requiredConfigured: true,
      tokenProvided: true,
      allowed: false,
      reason: "token_mismatch",
    };
  }

  return {
    isLocalhost: false,
    requiredConfigured: true,
    tokenProvided: true,
    allowed: true,
    reason: "allowed",
  };
}

export function GET(req: Request) {
  const result = checkAdminAccess(req);
  return Response.json(result, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

