"use client";

export const REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY = "remcochat:lanAdminToken";
export const REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY =
  "remcochat:lanAdminToken:session";

export function resolveStoredLanAdminToken(input: {
  localToken: string | null;
  sessionToken: string | null;
}): string {
  const session = String(input.sessionToken ?? "").trim();
  if (session) return session;
  return String(input.localToken ?? "").trim();
}

export function shouldRememberStoredLanAdminToken(input: {
  localToken: string | null;
  sessionToken: string | null;
}): boolean {
  return (
    !String(input.sessionToken ?? "").trim() &&
    Boolean(String(input.localToken ?? "").trim())
  );
}

export function resolveLanAdminTokenStorageTargets(input: {
  remember: boolean;
  token: string;
}): {
  localToken: string | null;
  sessionToken: string | null;
} {
  const token = String(input.token ?? "").trim();
  if (!token) {
    return { localToken: null, sessionToken: null };
  }

  return input.remember
    ? { localToken: token, sessionToken: null }
    : { localToken: null, sessionToken: token };
}

export function buildLanAdminAuthHeaders(
  token: string | null | undefined
): Record<string, string> {
  const normalizedToken = String(token ?? "").trim();
  return normalizedToken
    ? { "x-remcochat-admin-token": normalizedToken }
    : {};
}

export function readLanAdminTokenFromWindow(): string {
  if (typeof window === "undefined") return "";

  return resolveStoredLanAdminToken({
    localToken: window.localStorage.getItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY),
    sessionToken: window.sessionStorage.getItem(
      REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY
    ),
  });
}

export function readStoredLanAdminStateFromWindow() {
  if (typeof window === "undefined") {
    return {
      hasToken: false,
      remember: false,
      token: "",
    };
  }

  const localToken = window.localStorage.getItem(
    REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY
  );
  const sessionToken = window.sessionStorage.getItem(
    REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY
  );
  const token = resolveStoredLanAdminToken({ localToken, sessionToken });

  return {
    hasToken: Boolean(token),
    remember: shouldRememberStoredLanAdminToken({ localToken, sessionToken }),
    token,
  };
}
