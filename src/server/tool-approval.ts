import { isRequestAllowedByAdminPolicy } from "@/server/request-auth";

export function shouldRequirePrivilegedToolApproval(request: Request): boolean {
  // RemcoChat is local-only. Once a request is trusted enough to expose a
  // privileged server-owned tool, do not add a second interactive approval hop.
  return !isRequestAllowedByAdminPolicy(request);
}
