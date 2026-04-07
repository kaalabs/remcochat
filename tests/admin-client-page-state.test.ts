import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdminClientHeaders,
} from "../src/app/admin/admin-client-page-state";

test("buildAdminClientHeaders reads the stored LAN admin token from window storage", () => {
  const localStorageState = new Map<string, string>();
  const sessionStorageState = new Map<string, string>();

  localStorageState.set("remcochat:lanAdminToken", "local-token");
  sessionStorageState.set("remcochat:lanAdminToken:session", "session-token");

  const previousWindow = globalThis.window;
  const nextWindow = {
    localStorage: {
      getItem(key: string) {
        return localStorageState.get(key) ?? null;
      },
    },
    sessionStorage: {
      getItem(key: string) {
        return sessionStorageState.get(key) ?? null;
      },
    },
  } as Window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: nextWindow,
  });

  try {
    assert.deepEqual(buildAdminClientHeaders(), {
      "x-remcochat-admin-token": "session-token",
    });
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});
