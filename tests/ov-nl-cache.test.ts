import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createOvNlTools, __test__ as ovNlToolTest } from "../src/ai/ov-nl-tools";
import { __test__ as ovNlClientTest } from "../src/server/integrations/ov-nl/client";
import { _resetConfigCacheForTests } from "../src/server/config";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_NS_KEY = process.env.NS_APP_SUBSCRIPTION_KEY;

function writeTempConfigToml(content: string) {
  const filePath = path.join(
    os.tmpdir(),
    `remcochat-config-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`
  );
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

afterEach(() => {
  _resetConfigCacheForTests();
  ovNlToolTest.resetCache();
  ovNlClientTest.resetPreferredBaseUrl();
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_CONFIG_PATH === undefined) {
    delete process.env.REMCOCHAT_CONFIG_PATH;
  } else {
    process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
  }
  if (ORIGINAL_NS_KEY === undefined) {
    delete process.env.NS_APP_SUBSCRIPTION_KEY;
  } else {
    process.env.NS_APP_SUBSCRIPTION_KEY = ORIGINAL_NS_KEY;
  }
});

test("reuses cached ovNlGateway result within TTL", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"
cache_max_ttl_seconds = 60

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify({
        payload: [
          {
            code: "UT",
            UICCode: "8400621",
            namen: { kort: "Utrecht C.", middel: "Utrecht Centraal", lang: "Utrecht Centraal" },
            land: "NL",
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=20",
        },
      }
    );
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);
  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;

  const first = await ovNlGateway.execute({
    action: "stations.search",
    args: { query: "utrecht", limit: 5 },
  }) as {
    kind: string;
    cached: boolean;
    cacheTtlSeconds: number;
  };
  assert.equal(first.kind, "stations.search");
  assert.equal(first.cached, false);
  assert.equal(first.cacheTtlSeconds, 20);
  assert.equal(fetchCount, 1);

  const second = await ovNlGateway.execute({
    action: "stations.search",
    args: { query: "utrecht", limit: 5 },
  }) as {
    kind: string;
    cached: boolean;
  };
  assert.equal(second.kind, "stations.search");
  assert.equal(second.cached, true);
  assert.equal(fetchCount, 1);
});

test("parses cache-control max-age", () => {
  assert.equal(ovNlClientTest.parseCacheControlMaxAgeSeconds("public, max-age=5"), 5);
  assert.equal(ovNlClientTest.parseCacheControlMaxAgeSeconds("max-age=60, stale-while-revalidate=30"), 60);
  assert.equal(ovNlClientTest.parseCacheControlMaxAgeSeconds("no-store"), null);
  assert.equal(ovNlClientTest.parseCacheControlMaxAgeSeconds(null), null);
});

test("retries once on transient upstream_unreachable error", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"
cache_max_ttl_seconds = 60

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      throw new Error("simulated transient network error");
    }

    return new Response(
      JSON.stringify({
        payload: [
          {
            code: "UT",
            UICCode: "8400621",
            namen: { kort: "Utrecht C.", middel: "Utrecht Centraal", lang: "Utrecht Centraal" },
            land: "NL",
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=20",
        },
      }
    );
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);
  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;

  const result = await ovNlGateway.execute({
    action: "stations.search",
    args: { query: "utrecht", limit: 5 },
  }) as {
    kind: string;
    stations?: unknown[];
  };

  assert.equal(result.kind, "stations.search");
  assert.equal(Array.isArray(result.stations), true);
  assert.equal(callCount, 2);
});
