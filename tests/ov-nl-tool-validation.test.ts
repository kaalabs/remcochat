import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createOvNlTools, __test__ as ovNlToolTest } from "../src/ai/ov-nl-tools";
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

test("ovNlGateway strips irrelevant args keys and executes departures.list", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  const seenUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seenUrls.push(url);

    if (url.includes("/api/v2/stations")) {
      return new Response(
        JSON.stringify({
          payload: [
            {
              code: "UT",
              UICCode: "8400621",
              namen: { kort: "Utrecht C.", middel: "Utrecht Centraal", lang: "Utrecht Centraal" },
              land: "NL",
              lat: 52.089,
              lng: 5.11,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "max-age=60",
          },
        }
      );
    }

    if (url.includes("/api/v2/departures")) {
      return new Response(
        JSON.stringify({
          payload: {
            source: "HARP",
            departures: [],
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "max-age=5",
          },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "departures.list",
    args: {
      station: "Utrecht",
      maxJourneys: 8,
      // Irrelevant keys for this action:
      from: "Amsterdam",
      to: "Groningen",
      ctxRecon: "abc",
      searchForArrival: true,
      type: ["DISRUPTION"],
      isActive: true,
    },
  }) as {
    kind: string;
    departures?: unknown[];
    station?: { code?: string };
  };

  assert.notEqual(result.kind, "error");
  assert.equal(result.kind, "departures.list");
  assert.equal(Array.isArray(result.departures), true);
  assert.equal(result.station?.code, "UT");
  assert.ok(seenUrls.some((url) => url.includes("/api/v2/stations")));
  assert.ok(seenUrls.some((url) => url.includes("/api/v2/departures")));
});

test("ovNlGateway departures.window filters departures to requested time window", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  const seenUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seenUrls.push(url);

    if (url.includes("/api/v2/stations")) {
      return new Response(
        JSON.stringify({
          payload: [
            {
              code: "UT",
              UICCode: "8400621",
              namen: { kort: "Utrecht C.", middel: "Utrecht Centraal", lang: "Utrecht Centraal" },
              land: "NL",
              lat: 52.089,
              lng: 5.11,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "max-age=60",
          },
        }
      );
    }

    if (url.includes("/api/v2/departures")) {
      return new Response(
        JSON.stringify({
          payload: {
            source: "HARP",
            departures: [
              {
                plannedDateTime: "2030-02-07T17:50:00+01:00",
                direction: "Outside Window (early)",
                plannedTrack: "1",
                departureStatus: "ON_TIME",
                cancelled: false,
                product: { number: "1234", operatorName: "NS" },
              },
              {
                plannedDateTime: "2030-02-07T18:05:00+01:00",
                direction: "Inside Window",
                plannedTrack: "2",
                departureStatus: "ON_TIME",
                cancelled: false,
                product: { number: "2345", operatorName: "NS" },
              },
              {
                plannedDateTime: "2030-02-07T19:05:00+01:00",
                direction: "Outside Window (late)",
                plannedTrack: "3",
                departureStatus: "ON_TIME",
                cancelled: false,
                product: { number: "3456", operatorName: "NS" },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "max-age=5",
          },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "departures.window",
    args: {
      station: "Utrecht",
      date: "2030-02-07",
      fromTime: "18:00",
      toTime: "19:00",
      maxJourneys: 80,
    },
  }) as {
    kind: string;
    departures?: Array<{ destination?: string }>;
  };

  assert.equal(result.kind, "departures.window");
  assert.equal(result.departures?.length, 1);
  assert.equal(result.departures?.[0]?.destination, "Inside Window");

  const departuresUrl = seenUrls.find((u) => u.includes("/api/v2/departures"));
  assert.ok(departuresUrl);
  const parsed = new URL(departuresUrl!);
  assert.equal(parsed.searchParams.get("dateTime"), "2030-02-07T17:00:00.000Z");
});

test("ovNlGateway trips.search resolves unique exact station name without disambiguation", async () => {
  const configPath = writeTempConfigToml(`
	version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "").toLowerCase();
      if (q === "almere centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALMC",
                UICCode: "8400058",
                namen: {
                  kort: "Almere C.",
                  middel: "Almere Centrum",
                  lang: "Almere Centrum",
                },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }
      if (q === "groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
              {
                code: "GPE",
                UICCode: "8400312",
                namen: {
                  kort: "Gr. Europapark",
                  middel: "Groningen Europapark",
                  lang: "Groningen Europapark",
                },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify([
          {
            source: "HARP",
            trips: [{ uid: "trip-1", ctxRecon: "ctx-1", legs: [] }],
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "max-age=20" },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      limit: 3,
    },
  }) as {
    kind: string;
    to?: { code?: string; nameLong?: string };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.to?.code, "GN");
  assert.equal(result.to?.nameLong, "Groningen");
});

test("ovNlGateway trips.search prefers Almere abbreviation over unrelated Amersfoort matches", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "AMF",
                UICCode: "8400050",
                namen: {
                  kort: "Amersfoort",
                  middel: "Amersfoort C.",
                  lang: "Amersfoort Centraal",
                },
                land: "NL",
              },
              {
                code: "ALM",
                UICCode: "8400080",
                namen: {
                  kort: "Almere C",
                  middel: "Almere C.",
                  lang: "Almere C.",
                },
                land: "NL",
              },
              {
                code: "AML",
                UICCode: "8400045",
                namen: {
                  kort: "Almelo",
                  middel: "Almelo",
                  lang: "Almelo",
                },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }

      if (q === "Groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [{ uid: "trip-almere-1", ctxRecon: "ctx-almere-1", legs: [] }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "max-age=20" },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      limit: 3,
    },
  }) as {
    kind: string;
    from?: { code?: string };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.from?.code, "ALM");
});

test("ovNlGateway trips.search accepts object-shaped NS trips response", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALMC",
                UICCode: "8400058",
                namen: {
                  kort: "Almere C.",
                  middel: "Almere Centrum",
                  lang: "Almere Centrum",
                },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }
      if (q === "Groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [{ uid: "trip-obj-1", ctxRecon: "ctx-obj-1", legs: [] }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "max-age=20" },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      limit: 3,
    },
  }) as {
    kind: string;
    trips?: Array<{ uid?: string }>;
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(Array.isArray(result.trips), true);
  assert.equal(result.trips?.[0]?.uid, "trip-obj-1");
});

test("ovNlGateway trips.search accepts station codes when station search returns no matches", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  const seenTripUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      return new Response(JSON.stringify({ payload: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "max-age=30" },
      });
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      seenTripUrls.push(url.toString());
      return new Response(
        JSON.stringify([
          {
            source: "HARP",
            trips: [{ uid: "trip-1", ctxRecon: "ctx-1", legs: [] }],
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "max-age=20" },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "ALMC",
      to: "GN",
      limit: 3,
    },
  }) as {
    kind: string;
    from?: { code?: string };
    to?: { code?: string };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.from?.code, "ALMC");
  assert.equal(result.to?.code, "GN");
  assert.ok(
    seenTripUrls.some(
      (url) => url.includes("fromStation=ALMC") && url.includes("toStation=GN")
    )
  );
});

test("ovNlGateway trips.search accepts natural-language dateTime like today", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  const seenTripUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALMC",
                UICCode: "8400058",
                namen: {
                  kort: "Almere C.",
                  middel: "Almere Centrum",
                  lang: "Almere Centrum",
                },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }
      if (q === "Groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      seenTripUrls.push(url.toString());
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [{ uid: "trip-today-1", ctxRecon: "ctx-today-1", legs: [] }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "max-age=20" },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      dateTime: "today",
      limit: 3,
    },
  }) as {
    kind: string;
    trips?: Array<{ uid?: string }>;
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.[0]?.uid, "trip-today-1");
  assert.ok(seenTripUrls.some((url) => url.includes("dateTime=")));
});

test("ovNlGateway trips.search defaults past dateTime to now and filters departed trips", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  const originalNow = Date.now;
  const fixedNowIso = "2026-02-06T12:00:00.000Z";
  const fixedNowMs = Date.parse(fixedNowIso);
  Date.now = () => fixedNowMs;

  try {
    let seenTripsDateTime: string | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/api/v2/stations")) {
        const q = String(url.searchParams.get("q") ?? "");
        if (q === "Almere Centrum") {
          return new Response(
            JSON.stringify({
              payload: [
                {
                  code: "ALMC",
                  UICCode: "8400058",
                  namen: {
                    kort: "Almere C.",
                    middel: "Almere Centrum",
                    lang: "Almere Centrum",
                  },
                  land: "NL",
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json", "cache-control": "max-age=30" },
            }
          );
        }
        if (q === "Groningen") {
          return new Response(
            JSON.stringify({
              payload: [
                {
                  code: "GN",
                  UICCode: "8400261",
                  namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                  land: "NL",
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json", "cache-control": "max-age=30" },
            }
          );
        }
      }

      if (url.pathname.endsWith("/api/v3/trips")) {
        seenTripsDateTime = url.searchParams.get("dateTime");
        return new Response(
          JSON.stringify({
            source: "HARP",
            trips: [
              {
                uid: "past-trip",
                ctxRecon: "ctx-past",
                legs: [
                  {
                    idx: "0",
                    travelType: "PUBLIC_TRANSIT",
                    name: "NS Intercity",
                    origin: {
                      name: "Almere Centrum",
                      plannedDateTime: "2026-02-06T10:00:00+01:00",
                    },
                    destination: {
                      name: "Groningen",
                      plannedDateTime: "2026-02-06T11:30:00+01:00",
                    },
                    stops: [],
                  },
                ],
              },
              {
                uid: "future-trip",
                ctxRecon: "ctx-future",
                legs: [
                  {
                    idx: "0",
                    travelType: "PUBLIC_TRANSIT",
                    name: "NS Intercity",
                    origin: {
                      name: "Almere Centrum",
                      plannedDateTime: "2026-02-06T13:30:00+01:00",
                    },
                    destination: {
                      name: "Groningen",
                      plannedDateTime: "2026-02-06T15:00:00+01:00",
                    },
                    stops: [],
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=20" },
          }
        );
      }

      return new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
    const tools = createOvNlTools({ request: req });
    assert.equal(tools.enabled, true);

    const ovNlGateway = (
      tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
    ).ovNlGateway;
    assert.ok(ovNlGateway);

    const result = await ovNlGateway.execute({
      action: "trips.search",
      args: {
        from: "Almere Centrum",
        to: "Groningen",
        // Simulate the model guessing a time earlier today.
        dateTime: "2026-02-06T09:00:00+01:00",
        limit: 6,
      },
    }) as {
      kind: string;
      trips?: Array<{ uid?: string }>;
    };

    assert.equal(result.kind, "trips.search");
    assert.ok(seenTripsDateTime);
    assert.equal(Date.parse(String(seenTripsDateTime)), fixedNowMs);
    assert.equal(result.trips?.length, 1);
    assert.equal(result.trips?.[0]?.uid, "future-trip");
  } finally {
    Date.now = originalNow;
  }
});

test("ovNlGateway trips.detail parses per-leg stops when available", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v3/trips/trip")) {
      return new Response(
        JSON.stringify({
          uid: "trip-detail-1",
          ctxRecon: "ctx-detail-1",
          transfers: 1,
          plannedDurationInMinutes: 42,
          optimal: true,
          realtime: true,
          legs: [
            {
              idx: "0",
              travelType: "PUBLIC_TRANSIT",
              journeyDetailRef: "journey-abc",
              product: { displayName: "IC 1234" },
              direction: "Rotterdam",
              cancelled: false,
              origin: {
                name: "Amsterdam Centraal",
                plannedDateTime: "2026-02-08T17:30:00.000+01:00",
                actualDateTime: "2026-02-08T17:31:00.000+01:00",
                plannedTrack: "5",
                actualTrack: "5",
              },
              destination: {
                name: "Rotterdam Centraal",
                plannedDateTime: "2026-02-08T18:12:00.000+01:00",
                actualDateTime: "2026-02-08T18:13:00.000+01:00",
                plannedTrack: "7",
                actualTrack: "8",
              },
              stops: [
                {
                  name: "Amsterdam Centraal",
                  plannedDateTime: "2026-02-08T17:30:00.000+01:00",
                  actualDateTime: "2026-02-08T17:31:00.000+01:00",
                  plannedTrack: "5",
                  actualTrack: "5",
                  cancelled: false,
                },
                {
                  name: "Pass-through station",
                  plannedDateTime: null,
                  actualDateTime: null,
                  plannedTrack: null,
                  actualTrack: null,
                  cancelled: false,
                },
                {
                  name: "Schiphol",
                  plannedDateTime: "2026-02-08T17:45:00.000+01:00",
                  actualDateTime: null,
                  plannedTrack: "3",
                  actualTrack: null,
                  cancelled: false,
                },
                {
                  stop: { name: "Den Haag HS" },
                  arrivals: [
                    {
                      plannedDateTime: "2026-02-08T18:00:00.000+01:00",
                      actualDateTime: "2026-02-08T18:01:00.000+01:00",
                      plannedTrack: null,
                      actualTrack: null,
                      platform: "6",
                      track: "7",
                    },
                  ],
                },
                {
                  name: "Zwolle",
                  plannedArrivalDateTime: "2026-02-08T20:16:00.000+01:00",
                  actualArrivalDateTime: "2026-02-08T20:17:00.000+01:00",
                  plannedArrivalTrack: { platformNumber: 5 },
                  actualArrivalTrack: { trackNumber: 6 },
                },
                {
                  name: "Rotterdam Centraal",
                  plannedDateTime: "2026-02-08T18:12:00.000+01:00",
                  actualDateTime: "2026-02-08T18:13:00.000+01:00",
                  plannedTrack: "7",
                  actualTrack: "8",
                  cancelled: false,
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "max-age=20" },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = (await ovNlGateway.execute({
    action: "trips.detail",
    // Models may carry over constraints from a previous trips.search; these should not break details.
    args: {
      ctxRecon: "ctx-detail-1",
      intent: {
        hard: {
          maxTransfers: 0,
          includeModes: ["PUBLIC_TRANSIT"],
          excludeModes: ["WALK"],
          disruptionTypes: ["DISRUPTION"],
        },
      },
    },
  })) as any;

  assert.equal(result.kind, "trips.detail");
  assert.equal(result.trip?.ctxRecon, "ctx-detail-1");
  assert.equal(result.trip?.legs?.[0]?.stopCount, 5);
  assert.equal(result.trip?.legs?.[0]?.stops?.length, 5);
  assert.equal(result.trip?.legs?.[0]?.stops?.[0]?.name, "Amsterdam Centraal");
  assert.equal(result.trip?.legs?.[0]?.stops?.some((stop: any) => stop?.name === "Schiphol"), true);
  assert.equal(
    result.trip?.legs?.[0]?.stops?.some(
      (stop: any) => stop?.name === "Den Haag HS" && stop?.actualTrack === "7" && stop?.plannedTrack === "6"
    ),
    true
  );
  assert.equal(
    result.trip?.legs?.[0]?.stops?.some(
      (stop: any) => stop?.name === "Zwolle" && stop?.actualTrack === "6" && stop?.plannedTrack === "5"
    ),
    true
  );
});

test("ovNlGateway stations.search ignores irrelevant invalid date fields", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/v2/stations")) {
      return new Response(
        JSON.stringify({
          payload: [
            {
              code: "ALMC",
              UICCode: "8400058",
              namen: {
                kort: "Almere C.",
                middel: "Almere Centrum",
                lang: "Almere Centrum",
              },
              land: "NL",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "max-age=30" },
        }
      );
    }
    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "stations.search",
    args: {
      query: "Almere Centrum",
      limit: 5,
      dateTime: "x8chars..",
      date: "x8chars..",
      stationCode: "ALMC",
      from: "x",
      to: "x",
      type: "DISRUPTION",
    },
  }) as {
    kind: string;
    stations?: Array<{ code?: string }>;
  };

  assert.equal(result.kind, "stations.search");
  assert.equal(result.stations?.[0]?.code, "ALMC");
});

test("ovNlGateway stations.search rejects unsupported hard constraints", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        payload: [],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "max-age=30" },
      }
    );
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;
  const result = (await ovNlGateway.execute({
    action: "stations.search",
    args: {
      query: "Almere Centrum",
      intent: {
        hard: {
          directOnly: true,
        },
      },
    },
  })) as {
    kind: string;
    error?: { code?: string };
  };

  assert.equal(result.kind, "error");
  assert.equal(result.error?.code, "invalid_tool_input");
});

test("ovNlGateway auto-fixes stations.search route query to trips.search with strict direct intent", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALMC",
                UICCode: "8400058",
                namen: { kort: "Almere C.", middel: "Almere Centrum", lang: "Almere Centrum" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }

      if (q === "groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [
            {
              uid: "trip-direct",
              ctxRecon: "ctx-direct",
              transfers: 0,
              plannedDurationInMinutes: 95,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T13:00:00+01:00",
                    plannedTrack: "5",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T14:35:00+01:00",
                    plannedTrack: "6",
                  },
                },
              ],
            },
            {
              uid: "trip-transfer",
              ctxRecon: "ctx-transfer",
              transfers: 1,
              plannedDurationInMinutes: 85,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Sprinter",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T12:55:00+01:00",
                    plannedTrack: "2",
                  },
                  destination: {
                    name: "Zwolle",
                    plannedDateTime: "2030-02-07T13:55:00+01:00",
                    plannedTrack: "3",
                  },
                },
                {
                  idx: "1",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Zwolle",
                    plannedDateTime: "2030-02-07T14:05:00+01:00",
                    plannedTrack: "4",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T14:20:00+01:00",
                    plannedTrack: "5",
                  },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=20" } }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = (await ovNlGateway.execute({
    action: "stations.search",
    args: {
      query:
        "ik wil vandaag van Almere Centrum naar groningen. geef me treinopties met een directe verbinding.",
      intent: {
        hard: {
          directOnly: true,
        },
      },
    },
  })) as {
    kind: string;
    trips?: Array<{ transfers?: unknown; uid?: unknown }>;
    intentMeta?: { appliedHard?: string[]; appliedSoft?: string[] };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(Array.isArray(result.trips), true);
  assert.equal(result.trips?.length, 1);
  assert.equal(result.trips?.[0]?.uid, "trip-direct");
  assert.equal(Number(result.trips?.[0]?.transfers ?? NaN), 0);
  assert.equal(result.intentMeta?.appliedHard?.includes("directOnly"), true);
  assert.equal(result.intentMeta?.appliedSoft?.includes("fewest_transfers"), false);
});

test("ovNlGateway auto-fix maps 'vanmiddag' to an afternoon trips.search datetime", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  let observedDateTime = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "almere centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALMC",
                UICCode: "8400058",
                namen: { kort: "Almere C.", middel: "Almere Centrum", lang: "Almere Centrum" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }

      if (q === "groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      observedDateTime = String(url.searchParams.get("dateTime") ?? "");
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [
            {
              uid: "trip-afternoon",
              ctxRecon: "ctx-afternoon",
              transfers: 0,
              plannedDurationInMinutes: 95,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T15:10:00+01:00",
                    plannedTrack: "5",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T16:45:00+01:00",
                    plannedTrack: "6",
                  },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=20" } }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;

  const result = (await ovNlGateway.execute({
    action: "stations.search",
    args: {
      query: "ik wil vanmiddag van almere centrum naar groningen. geef me directe treinopties.",
    },
  })) as { kind: string; trips?: Array<{ uid?: string }> };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.[0]?.uid, "trip-afternoon");
  assert.equal(observedDateTime.includes("T"), true);
  assert.equal(observedDateTime.length > 0, true);
});

test("ovNlGateway auto-fixes low-transfer preference phrasing to soft fewest_transfers ranking", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "almere centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALMC",
                UICCode: "8400058",
                namen: { kort: "Almere C.", middel: "Almere Centrum", lang: "Almere Centrum" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }

      if (q === "groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [
            {
              uid: "trip-transfer",
              ctxRecon: "ctx-transfer",
              transfers: 1,
              plannedDurationInMinutes: 85,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Sprinter",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T12:55:00+01:00",
                    plannedTrack: "2",
                  },
                  destination: {
                    name: "Zwolle",
                    plannedDateTime: "2030-02-07T13:55:00+01:00",
                    plannedTrack: "3",
                  },
                },
                {
                  idx: "1",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Zwolle",
                    plannedDateTime: "2030-02-07T14:05:00+01:00",
                    plannedTrack: "4",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T14:20:00+01:00",
                    plannedTrack: "5",
                  },
                },
              ],
            },
            {
              uid: "trip-direct",
              ctxRecon: "ctx-direct",
              transfers: 0,
              plannedDurationInMinutes: 95,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T13:00:00+01:00",
                    plannedTrack: "5",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T14:35:00+01:00",
                    plannedTrack: "6",
                  },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=20" } }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;

  const result = (await ovNlGateway.execute({
    action: "stations.search",
    args: {
      query: "ik wil van almere centrum naar groningen met zo min mogelijk overstappen.",
    },
  })) as {
    kind: string;
    trips?: Array<{ uid?: string }>;
    intentMeta?: { appliedSoft?: string[] };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.[0]?.uid, "trip-direct");
  assert.equal(result.intentMeta?.appliedSoft?.includes("fewest_transfers"), true);
});

test("ovNlGateway trips.search ignores whitespace and null placeholder optional fields", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALM",
                UICCode: "8400080",
                namen: {
                  kort: "Almere C",
                  middel: "Almere C.",
                  lang: "Almere Centrum",
                },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }

      if (q === "Groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400263",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "max-age=30" },
          }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [{ uid: "trip-whitespace-1", ctxRecon: "ctx-ws-1", legs: [] }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "max-age=20" },
        }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (
    tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = await ovNlGateway.execute({
    action: "trips.search",
    args: {
      query: "Almere Centrum naar Groningen",
      limit: null,
      countryCodes: ["NL"],
      latitude: 0,
      longitude: 0,
      lat: 0,
      lng: 0,
      station: "Almere Centrum",
      stationCode: "Almere Centrum",
      uicCode: "Almere Centrum",
      dateTime: null,
      maxJourneys: 6,
      lang: null,
      from: "Almere Centrum",
      to: "Groningen",
      via: null,
      searchForArrival: null,
      date: "2026-02-06",
      ctxRecon: null,
      id: "1",
      train: 1,
      departureUicCode: null,
      transferUicCode: null,
      arrivalUicCode: null,
      omitCrowdForecast: true,
      type: ["DISRUPTION"],
      isActive: null,
      intent: {
        hard: {
          directOnly: true,
          maxTransfers: null,
        },
      },
    },
  }) as {
    kind: string;
    trips?: Array<{ uid?: string }>;
    error?: { code?: string };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.[0]?.uid, "trip-whitespace-1");
});

test("ovNlGateway trips.search enforces hard directOnly intent", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALMC",
                UICCode: "8400058",
                namen: { kort: "Almere C.", middel: "Almere Centrum", lang: "Almere Centrum" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
      if (q === "Groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [
            {
              uid: "trip-direct",
              ctxRecon: "ctx-direct",
              transfers: 0,
              plannedDurationInMinutes: 95,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T13:00:00+01:00",
                    plannedTrack: "5",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T14:35:00+01:00",
                    plannedTrack: "6",
                  },
                },
              ],
            },
            {
              uid: "trip-transfer",
              ctxRecon: "ctx-transfer",
              transfers: 1,
              plannedDurationInMinutes: 85,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Sprinter",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T12:55:00+01:00",
                    plannedTrack: "2",
                  },
                  destination: {
                    name: "Zwolle",
                    plannedDateTime: "2030-02-07T13:55:00+01:00",
                    plannedTrack: "3",
                  },
                },
                {
                  idx: "1",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Zwolle",
                    plannedDateTime: "2030-02-07T14:05:00+01:00",
                    plannedTrack: "4",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T14:20:00+01:00",
                    plannedTrack: "5",
                  },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=20" } }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = (await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      intent: {
        hard: {
          directOnly: true,
        },
      },
    },
  })) as {
    kind: string;
    trips?: Array<{ uid?: string }>;
    intentMeta?: { appliedHard?: string[] };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.length, 1);
  assert.equal(result.trips?.[0]?.uid, "trip-direct");
  assert.equal(result.intentMeta?.appliedHard?.includes("directOnly"), true);
});

test("ovNlGateway trips.search coerces stringified scalar intent fields from tool input", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "ALMC",
                UICCode: "8400058",
                namen: { kort: "Almere C.", middel: "Almere Centrum", lang: "Almere Centrum" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
      if (q === "Groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "GN",
                UICCode: "8400261",
                namen: { kort: "Groningen", middel: "Groningen", lang: "Groningen" },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
    }

    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [
            {
              uid: "trip-direct",
              ctxRecon: "ctx-direct",
              transfers: 0,
              plannedDurationInMinutes: 95,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T13:00:00+01:00",
                    plannedTrack: "5",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T14:35:00+01:00",
                    plannedTrack: "6",
                  },
                },
              ],
            },
            {
              uid: "trip-transfer",
              ctxRecon: "ctx-transfer",
              transfers: 1,
              plannedDurationInMinutes: 85,
              realtime: true,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Sprinter",
                  origin: {
                    name: "Almere Centrum",
                    plannedDateTime: "2030-02-07T12:55:00+01:00",
                    plannedTrack: "2",
                  },
                  destination: {
                    name: "Zwolle",
                    plannedDateTime: "2030-02-07T13:55:00+01:00",
                    plannedTrack: "3",
                  },
                },
                {
                  idx: "1",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: {
                    name: "Zwolle",
                    plannedDateTime: "2030-02-07T14:05:00+01:00",
                    plannedTrack: "4",
                  },
                  destination: {
                    name: "Groningen",
                    plannedDateTime: "2030-02-07T14:20:00+01:00",
                    plannedTrack: "5",
                  },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=20" } }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;
  assert.ok(ovNlGateway);

  const result = (await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      limit: "6",
      searchForArrival: "false",
      intent: {
        hard: {
          directOnly: "true",
          maxTransfers: "0",
          maxDurationMinutes: "0",
          includeOperators: "NS",
        },
        soft: {
          rankBy: "fewest_transfers",
        },
      },
    },
  })) as {
    kind: string;
    trips?: Array<{ uid?: string }>;
    intentMeta?: { appliedHard?: string[] };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.length, 1);
  assert.equal(result.trips?.[0]?.uid, "trip-direct");
  assert.equal(result.intentMeta?.appliedHard?.includes("directOnly"), true);
  assert.equal(result.intentMeta?.appliedHard?.includes("maxDurationMinutes"), false);
});

test("ovNlGateway trips.search applies soft fastest ranking", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum" || q === "Groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: q === "Almere Centrum" ? "ALMC" : "GN",
                UICCode: q === "Almere Centrum" ? "8400058" : "8400261",
                namen: { kort: q, middel: q, lang: q },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
    }
    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [
            {
              uid: "trip-slow",
              ctxRecon: "ctx-slow",
              transfers: 0,
              plannedDurationInMinutes: 120,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: { name: "Almere Centrum", plannedDateTime: "2030-02-07T12:00:00+01:00" },
                  destination: { name: "Groningen", plannedDateTime: "2030-02-07T14:00:00+01:00" },
                },
              ],
            },
            {
              uid: "trip-fast",
              ctxRecon: "ctx-fast",
              transfers: 0,
              plannedDurationInMinutes: 90,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Intercity",
                  origin: { name: "Almere Centrum", plannedDateTime: "2030-02-07T12:10:00+01:00" },
                  destination: { name: "Groningen", plannedDateTime: "2030-02-07T13:40:00+01:00" },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=20" } }
      );
    }
    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;
  const result = (await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      intent: {
        soft: {
          rankBy: ["fastest"],
        },
      },
    },
  })) as {
    kind: string;
    trips?: Array<{ uid?: string }>;
    intentMeta?: { appliedSoft?: string[] };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.[0]?.uid, "trip-fast");
  assert.equal(result.intentMeta?.appliedSoft?.includes("fastest"), true);
});

test("ovNlGateway trips.search returns direct-only empty state plus best alternatives when strict direct has no match", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "");
      if (q === "Almere Centrum" || q === "Groningen") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: q === "Almere Centrum" ? "ALMC" : "GN",
                UICCode: q === "Almere Centrum" ? "8400058" : "8400261",
                namen: { kort: q, middel: q, lang: q },
                land: "NL",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
        );
      }
    }
    if (url.pathname.endsWith("/api/v3/trips")) {
      return new Response(
        JSON.stringify({
          source: "HARP",
          trips: [
            {
              uid: "trip-transfer-a",
              ctxRecon: "ctx-a",
              transfers: 1,
              plannedDurationInMinutes: 95,
              legs: [
                {
                  idx: "0",
                  travelType: "PUBLIC_TRANSIT",
                  name: "NS Sprinter",
                  origin: { name: "Almere Centrum", plannedDateTime: "2030-02-07T12:00:00+01:00" },
                  destination: { name: "Zwolle", plannedDateTime: "2030-02-07T13:00:00+01:00" },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=20" } }
      );
    }
    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;

  const result = (await ovNlGateway.execute({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      intent: {
        hard: {
          directOnly: true,
        },
      },
    },
  })) as {
    kind: string;
    trips?: Array<{ uid?: string; transfers?: number }>;
    directOnlyAlternatives?: { maxTransfers?: number; trips?: Array<{ uid?: string; transfers?: number }> };
    intentMeta?: { appliedHard?: string[] };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.length, 0);
  assert.equal(result.directOnlyAlternatives?.maxTransfers, 1);
  assert.equal(result.directOnlyAlternatives?.trips?.length, 1);
  assert.equal(result.directOnlyAlternatives?.trips?.[0]?.uid, "trip-transfer-a");
  assert.equal(result.directOnlyAlternatives?.trips?.[0]?.transfers, 1);
  assert.equal(result.intentMeta?.appliedHard?.includes("directOnly"), true);
});

test("ovNlGateway departures.list filters with hard platform and cancelled constraints", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/v2/stations")) {
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
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } }
      );
    }
    if (url.pathname.endsWith("/api/v2/departures")) {
      return new Response(
        JSON.stringify({
          payload: {
            departures: [
              {
                plannedDateTime: "2030-02-07T18:05:00+01:00",
                direction: "Groningen",
                plannedTrack: "2",
                departureStatus: "ON_TIME",
                cancelled: false,
                product: { number: "1234", operatorName: "NS" },
              },
              {
                plannedDateTime: "2030-02-07T18:10:00+01:00",
                direction: "Amsterdam",
                plannedTrack: "3",
                departureStatus: "ON_TIME",
                cancelled: false,
                product: { number: "4321", operatorName: "NS" },
              },
              {
                plannedDateTime: "2030-02-07T18:12:00+01:00",
                direction: "Rotterdam",
                plannedTrack: "2",
                departureStatus: "CANCELLED",
                cancelled: true,
                product: { number: "5555", operatorName: "NS" },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=5" } }
      );
    }
    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;
  const result = (await ovNlGateway.execute({
    action: "departures.list",
    args: {
      station: "Utrecht",
      intent: {
        hard: {
          excludeCancelled: true,
          platformEquals: "2",
        },
      },
    },
  })) as {
    kind: string;
    departures?: Array<{ destination?: string }>;
  };

  assert.equal(result.kind, "departures.list");
  assert.equal(result.departures?.length, 1);
  assert.equal(result.departures?.[0]?.destination, "Groningen");
});

test("ovNlGateway disruptions.list filters with hard active/type constraints", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"
base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]
subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);
  process.env.REMCOCHAT_CONFIG_PATH = configPath;
  process.env.NS_APP_SUBSCRIPTION_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/v3/disruptions")) {
      return new Response(
        JSON.stringify([
          { id: "d1", type: "DISRUPTION", title: "D1", isActive: true },
          { id: "d2", type: "MAINTENANCE", title: "D2", isActive: true },
          { id: "d3", type: "DISRUPTION", title: "D3", isActive: false },
        ]),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=10" } }
      );
    }
    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;

  const result = (await ovNlGateway.execute({
    action: "disruptions.list",
    args: {
      intent: {
        hard: {
          disruptionTypes: ["DISRUPTION"],
          activeOnly: true,
        },
      },
    },
  })) as {
    kind: string;
    disruptions?: Array<{ id?: string }>;
  };

  assert.equal(result.kind, "disruptions.list");
  assert.equal(result.disruptions?.length, 1);
  assert.equal(result.disruptions?.[0]?.id, "d1");
});
