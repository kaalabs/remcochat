import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLanAdminAuthHeaders,
  resolveLanAdminTokenStorageTargets,
  resolveStoredLanAdminToken,
  shouldRememberStoredLanAdminToken,
} from "../src/app/lan-admin-token-storage";

test("resolveStoredLanAdminToken prefers the session token and trims values", () => {
  assert.equal(
    resolveStoredLanAdminToken({
      localToken: "  local-token  ",
      sessionToken: "  session-token  ",
    }),
    "session-token"
  );
  assert.equal(
    resolveStoredLanAdminToken({
      localToken: "  local-token  ",
      sessionToken: "   ",
    }),
    "local-token"
  );
  assert.equal(
    resolveStoredLanAdminToken({
      localToken: null,
      sessionToken: null,
    }),
    ""
  );
});

test("shouldRememberStoredLanAdminToken only tracks persisted local tokens", () => {
  assert.equal(
    shouldRememberStoredLanAdminToken({
      localToken: "local-token",
      sessionToken: null,
    }),
    true
  );
  assert.equal(
    shouldRememberStoredLanAdminToken({
      localToken: "local-token",
      sessionToken: "session-token",
    }),
    false
  );
  assert.equal(
    shouldRememberStoredLanAdminToken({
      localToken: "   ",
      sessionToken: null,
    }),
    false
  );
});

test("resolveLanAdminTokenStorageTargets writes either local or session storage, or clears both", () => {
  assert.deepEqual(
    resolveLanAdminTokenStorageTargets({
      remember: true,
      token: "  saved-token  ",
    }),
    {
      localToken: "saved-token",
      sessionToken: null,
    }
  );
  assert.deepEqual(
    resolveLanAdminTokenStorageTargets({
      remember: false,
      token: "  session-token  ",
    }),
    {
      localToken: null,
      sessionToken: "session-token",
    }
  );
  assert.deepEqual(
    resolveLanAdminTokenStorageTargets({
      remember: true,
      token: "   ",
    }),
    {
      localToken: null,
      sessionToken: null,
    }
  );
});

test("buildLanAdminAuthHeaders only emits the admin header for non-empty tokens", () => {
  assert.deepEqual(buildLanAdminAuthHeaders("  admin-token  "), {
    "x-remcochat-admin-token": "admin-token",
  });
  assert.deepEqual(buildLanAdminAuthHeaders("   "), {});
  assert.deepEqual(buildLanAdminAuthHeaders(null), {});
});
