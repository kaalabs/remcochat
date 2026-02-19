import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLlmCallErrorForUser } from "../src/server/llm-errors";

test("formats unsupported_country_region_territory with guidance", () => {
  const err = {
    statusCode: 403,
    url: "https://opencode.ai/zen/v1/responses",
    responseHeaders: {
      "cf-placement": "remote-HKG",
      "cf-ray": "test-ORD",
    },
    responseBody:
      '{"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported","param":null,"type":"request_forbidden"}}event: ping\\n' +
      'data: {"type":"ping","cost":"0"}\\n\\n',
  };

  const text = formatLlmCallErrorForUser(err, {
    providerName: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
  });

  assert.match(text, /unsupported country\/region/i);
  assert.match(text, /base_url=https:\/\/opencode\.ai\/zen\/v1/);
  assert.match(text, /cf-placement=remote-HKG/i);
  assert.match(text, /cloudflare worker|placement\/egress/i);
});

test("formats generic provider error with status and url", () => {
  const err = {
    statusCode: 500,
    url: "https://example.com/v1/responses",
    message: "Internal server error",
  };

  const text = formatLlmCallErrorForUser(err, { providerId: "example" });
  assert.match(text, /\(500\)/);
  assert.match(text, /URL: https:\/\/example\.com\/v1\/responses/);
  assert.match(text, /Internal server error/);
});
