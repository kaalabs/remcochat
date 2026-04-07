import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSkillsAdminPath,
  createAdminJsonRequestInit,
  resolveAdminTransportError,
} from "../src/app/admin/admin-client-api";

test("buildSkillsAdminPath only adds the rescan query when requested", () => {
  assert.equal(buildSkillsAdminPath(), "/api/skills");
  assert.equal(buildSkillsAdminPath({ rescan: false }), "/api/skills");
  assert.equal(buildSkillsAdminPath({ rescan: true }), "/api/skills?rescan=1");
});

test("resolveAdminTransportError prefers backend errors and falls back cleanly", () => {
  assert.equal(
    resolveAdminTransportError({
      fallbackErrorMessage: "fallback error",
      json: { error: "backend error" },
    }),
    "backend error"
  );
  assert.equal(
    resolveAdminTransportError({
      fallbackErrorMessage: "fallback error",
      json: { error: "   " },
    }),
    "fallback error"
  );
  assert.equal(
    resolveAdminTransportError({
      fallbackErrorMessage: "fallback error",
      json: null,
    }),
    "fallback error"
  );
});

test("createAdminJsonRequestInit preserves headers and serializes the JSON body", () => {
  const init = createAdminJsonRequestInit({
    body: { providerId: "provider-1" },
    headers: { "x-remcochat-admin-token": "token" },
    method: "PUT",
  });

  assert.deepEqual(init, {
    body: JSON.stringify({ providerId: "provider-1" }),
    headers: {
      "Content-Type": "application/json",
      "x-remcochat-admin-token": "token",
    },
    method: "PUT",
  });
});
