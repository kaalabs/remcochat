import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createExplicitOvNlSkillUnavailableHeaders,
  describePersistedExplicitOvNlSkillUnavailableHint,
  describeTemporaryExplicitOvNlSkillUnavailableHint,
} from "../src/server/chat/skills-runtime";

const originalAdminToken = process.env.REMCOCHAT_ADMIN_TOKEN;

afterEach(() => {
  if (typeof originalAdminToken === "string") {
    process.env.REMCOCHAT_ADMIN_TOKEN = originalAdminToken;
  } else {
    delete process.env.REMCOCHAT_ADMIN_TOKEN;
  }
});

test("describeTemporaryExplicitOvNlSkillUnavailableHint explains disabled config", () => {
  const hint = describeTemporaryExplicitOvNlSkillUnavailableHint({
    request: new Request("http://localhost"),
    ovNlConfig: null,
  });

  assert.match(hint, /staat niet aan in je server config/);
});

test("describeTemporaryExplicitOvNlSkillUnavailableHint explains localhost-only access on LAN", () => {
  const hint = describeTemporaryExplicitOvNlSkillUnavailableHint({
    request: new Request("http://192.168.1.5"),
    ovNlConfig: {
      enabled: true,
      access: "localhost",
      baseUrls: ["https://example.com"],
      timeoutMs: 5_000,
      subscriptionKeyEnv: "OV_SUBSCRIPTION_KEY",
      cacheMaxTtlSeconds: 20,
    },
  });

  assert.match(hint, /access="localhost"/);
});

test("describePersistedExplicitOvNlSkillUnavailableHint explains missing admin token", () => {
  process.env.REMCOCHAT_ADMIN_TOKEN = "server-secret";
  const hint = describePersistedExplicitOvNlSkillUnavailableHint({
    request: new Request("http://remcochat.local"),
  });

  assert.match(hint, /geen admin-token/);
});

test("createExplicitOvNlSkillUnavailableHeaders forces OV tool headers off", () => {
  const headers = createExplicitOvNlSkillUnavailableHeaders(
    (extra) => new Headers(extra as Record<string, string>),
  ) as Headers;

  assert.equal(headers.get("x-remcochat-ov-nl-tools-enabled"), "0");
  assert.equal(headers.get("x-remcochat-ov-nl-tools"), "");
});
