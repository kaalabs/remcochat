"use client";

import { useCallback, useEffect, useState } from "react";
import {
  buildLanAdminAuthHeaders,
  readLanAdminTokenFromWindow,
  readStoredLanAdminStateFromWindow,
  REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY,
  REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY,
  resolveLanAdminTokenStorageTargets,
} from "@/app/lan-admin-token-storage";

type AdminAccessResponse = {
  allowed: boolean;
  reason: string;
};

type UseHomeClientLanAdminInput = {
  lanAdminAccessEnabled: boolean;
};

export function useHomeClientLanAdmin({
  lanAdminAccessEnabled,
}: UseHomeClientLanAdminInput) {
  const readLanAdminToken = useCallback((): string => {
    return readLanAdminTokenFromWindow();
  }, []);

  const writeLanAdminToken = useCallback((token: string, remember: boolean) => {
    if (typeof window === "undefined") return;

    const next = resolveLanAdminTokenStorageTargets({ remember, token });
    if (next.localToken) {
      window.localStorage.setItem(
        REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY,
        next.localToken
      );
    } else {
      window.localStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY);
    }

    if (next.sessionToken) {
      window.sessionStorage.setItem(
        REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY,
        next.sessionToken
      );
    } else {
      window.sessionStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY);
    }
  }, []);

  const clearLanAdminToken = useCallback(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_SESSION_KEY);
    window.localStorage.removeItem(REMCOCHAT_LAN_ADMIN_TOKEN_LOCAL_KEY);
  }, []);

  const [lanAdminTokenOpen, setLanAdminTokenOpen] = useState(false);
  const [lanAdminTokenDraft, setLanAdminTokenDraft] = useState(
    () => readStoredLanAdminStateFromWindow().token
  );
  const [lanAdminTokenRemember, setLanAdminTokenRemember] = useState(
    () => readStoredLanAdminStateFromWindow().remember
  );
  const [lanAdminTokenVisible, setLanAdminTokenVisible] = useState(false);
  const [hasLanAdminToken, setHasLanAdminToken] = useState(
    () => readStoredLanAdminStateFromWindow().hasToken
  );
  const [lanAdminTokenAllowed, setLanAdminTokenAllowed] = useState<
    boolean | null
  >(null);
  const [lanAdminTokenAllowedReason, setLanAdminTokenAllowedReason] =
    useState("");
  const [bashToolsEnabledHeader, setBashToolsEnabledHeader] = useState<
    "0" | "1" | null
  >(null);

  const verifyLanAdminToken = useCallback(async () => {
    if (!lanAdminAccessEnabled) {
      setLanAdminTokenAllowed(null);
      setLanAdminTokenAllowedReason("");
      return;
    }

    const token = readLanAdminToken();
    if (!token) {
      setLanAdminTokenAllowed(null);
      setLanAdminTokenAllowedReason("");
      return;
    }

    try {
      const response = await fetch("/api/admin/access", {
        cache: "no-store",
        headers: buildLanAdminAuthHeaders(token),
      });
      const json = (await response.json().catch(() => null)) as
        | AdminAccessResponse
        | null;
      if (!json || typeof json.allowed !== "boolean") {
        setLanAdminTokenAllowed(null);
        setLanAdminTokenAllowedReason("invalid_response");
        return;
      }

      setLanAdminTokenAllowed(json.allowed);
      setLanAdminTokenAllowedReason(
        typeof json.reason === "string" ? json.reason : ""
      );
    } catch {
      setLanAdminTokenAllowed(null);
      setLanAdminTokenAllowedReason("network_error");
    }
  }, [lanAdminAccessEnabled, readLanAdminToken]);

  const syncLanAdminTokenDraftFromStorage = useCallback(() => {
    const next = readStoredLanAdminStateFromWindow();
    setHasLanAdminToken(next.hasToken);
    setLanAdminTokenDraft(next.token);
    setLanAdminTokenRemember(next.remember);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      verifyLanAdminToken().catch(() => {});
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lanAdminAccessEnabled, verifyLanAdminToken]);

  const setLanAdminTokenOpenWithSync = useCallback(
    (open: boolean) => {
      setLanAdminTokenOpen(open);
      if (!open) return;
      syncLanAdminTokenDraftFromStorage();
    },
    [syncLanAdminTokenDraftFromStorage]
  );

  const clearLanAdminTokenState = useCallback(() => {
    clearLanAdminToken();
    setLanAdminTokenDraft("");
    setHasLanAdminToken(false);
    setLanAdminTokenRemember(false);
    setLanAdminTokenAllowed(null);
    setLanAdminTokenAllowedReason("");
  }, [clearLanAdminToken]);

  const saveLanAdminToken = useCallback(() => {
    writeLanAdminToken(lanAdminTokenDraft, lanAdminTokenRemember);
    const token = readLanAdminToken();
    setHasLanAdminToken(Boolean(token));
    verifyLanAdminToken().catch(() => {});
    setLanAdminTokenOpen(false);
  }, [
    lanAdminTokenDraft,
    lanAdminTokenRemember,
    readLanAdminToken,
    verifyLanAdminToken,
    writeLanAdminToken,
  ]);

  const instrumentedChatFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await globalThis.fetch(input, init);
      const header = response.headers.get("x-remcochat-bash-tools-enabled");
      if (header === "0" || header === "1") setBashToolsEnabledHeader(header);
      return response;
    },
    []
  );

  return {
    clearLanAdminTokenState,
    instrumentedChatFetch,
    lanAdminAccess: {
      allowed: lanAdminAccessEnabled ? lanAdminTokenAllowed : null,
      allowedReason: lanAdminAccessEnabled ? lanAdminTokenAllowedReason : "",
      bashToolsEnabledHeader,
      draft: lanAdminAccessEnabled ? lanAdminTokenDraft : "",
      hasToken: lanAdminAccessEnabled ? hasLanAdminToken : false,
      open: lanAdminTokenOpen,
      remember: lanAdminAccessEnabled ? lanAdminTokenRemember : false,
      setDraft: setLanAdminTokenDraft,
      setOpen: setLanAdminTokenOpenWithSync,
      setRemember: setLanAdminTokenRemember,
      setVisible: setLanAdminTokenVisible,
      visible: lanAdminTokenVisible,
    },
    readLanAdminToken,
    saveLanAdminToken,
  };
}
