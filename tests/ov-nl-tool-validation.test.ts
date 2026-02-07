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

test("ovNlGateway trips.search ignores whitespace placeholder optional fields", async () => {
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
      limit: 6,
      countryCodes: ["NL"],
      latitude: 0,
      longitude: 0,
      lat: 0,
      lng: 0,
      station: "Almere Centrum",
      stationCode: "Almere Centrum",
      uicCode: "Almere Centrum",
      dateTime: "2026-02-06T09:00:00+01:00",
      maxJourneys: 6,
      lang: "nl",
      from: "Almere Centrum",
      to: "Groningen",
      via: " ",
      searchForArrival: false,
      date: "2026-02-06",
      ctxRecon: " ",
      id: "1",
      train: 1,
      departureUicCode: " ",
      transferUicCode: " ",
      arrivalUicCode: " ",
      omitCrowdForecast: true,
      type: ["DISRUPTION"],
      isActive: true,
    },
  }) as {
    kind: string;
    trips?: Array<{ uid?: string }>;
    error?: { code?: string };
  };

  assert.equal(result.kind, "trips.search");
  assert.equal(result.trips?.[0]?.uid, "trip-whitespace-1");
});
