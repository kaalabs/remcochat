import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createOvNlTools, __test__ as ovNlToolTest } from "../src/ai/ov-nl-tools";
import { routeOvNlCommand } from "../src/server/ov-nl-command";
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

function buildTripsPayload(input: { includeDirect: boolean }) {
  const trips: unknown[] = [
    {
      uid: "trip-transfer",
      ctxRecon: "ctx-transfer",
      transfers: 1,
      plannedDurationInMinutes: 95,
      realtime: true,
      legs: [
        {
          idx: "0",
          travelType: "PUBLIC_TRANSIT",
          name: "NS Sprinter",
          origin: {
            name: "Almere Muziekwijk",
            plannedDateTime: "2030-02-07T15:02:00+01:00",
            plannedTrack: "2",
          },
          destination: {
            name: "Zwolle",
            plannedDateTime: "2030-02-07T16:00:00+01:00",
            plannedTrack: "3",
          },
        },
        {
          idx: "1",
          travelType: "PUBLIC_TRANSIT",
          name: "NS Intercity",
          origin: {
            name: "Zwolle",
            plannedDateTime: "2030-02-07T16:05:00+01:00",
            plannedTrack: "4",
          },
          destination: {
            name: "Groningen",
            plannedDateTime: "2030-02-07T16:37:00+01:00",
            plannedTrack: "5",
          },
        },
      ],
    },
  ];

  if (input.includeDirect) {
    trips.unshift({
      uid: "trip-direct",
      ctxRecon: "ctx-direct",
      transfers: 0,
      plannedDurationInMinutes: 105,
      realtime: true,
      legs: [
        {
          idx: "0",
          travelType: "PUBLIC_TRANSIT",
          name: "NS Intercity",
          origin: {
            name: "Almere Muziekwijk",
            plannedDateTime: "2030-02-07T15:00:00+01:00",
            plannedTrack: "1",
          },
          destination: {
            name: "Groningen",
            plannedDateTime: "2030-02-07T16:45:00+01:00",
            plannedTrack: "5",
          },
        },
      ],
    });
  }

  return trips;
}

function mockFetchForPrompt(input: { includeDirect: boolean }) {
  const trips = buildTripsPayload({ includeDirect: input.includeDirect });
  globalThis.fetch = (async (requestInput: RequestInfo | URL) => {
    const url = new URL(String(requestInput));

    if (url.pathname.endsWith("/api/v2/stations")) {
      const q = String(url.searchParams.get("q") ?? "").toLowerCase();
      if (q === "almere muziekwijk") {
        return new Response(
          JSON.stringify({
            payload: [
              {
                code: "AMW",
                UICCode: "8400100",
                namen: {
                  kort: "Almere Muz.",
                  middel: "Almere Muziekwijk",
                  lang: "Almere Muziekwijk",
                },
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
          trips,
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=20" } }
      );
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

function setupOvConfig() {
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
}

async function runPrompt(prompt: string) {
  const routed = await routeOvNlCommand({ text: prompt });
  assert.equal(routed.ok, true);
  if (!routed.ok) return routed;

  const intent = routed.command.args.intent as
    | { hard?: { directOnly?: unknown; maxTransfers?: unknown } }
    | undefined;
  assert.equal(intent?.hard?.directOnly, true);
  assert.equal(intent?.hard?.maxTransfers, 0);

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });
  assert.equal(tools.enabled, true);

  const ovNlGateway = (tools.tools as Record<string, { execute: (input: unknown) => Promise<unknown> }>).ovNlGateway;
  return ovNlGateway.execute({ action: routed.command.action, args: routed.command.args });
}

test("end-user prompt returns only direct trips when direct options exist", async () => {
  setupOvConfig();
  mockFetchForPrompt({ includeDirect: true });

  const output = (await runPrompt(
    "ik wil vanmiddag van almere muziekwijk naar groningen. geef me directe treinopties."
  )) as {
    kind: string;
    trips?: Array<{ transfers?: unknown }>;
  };

  assert.equal(output.kind, "trips.search");
  const transfers = Array.isArray(output.trips) ? output.trips.map((trip) => Number(trip.transfers ?? NaN)) : [];
  assert.deepEqual(transfers, [0]);
});

test("end-user prompt returns direct-only empty plus best alternatives when no direct trips exist", async () => {
  setupOvConfig();
  mockFetchForPrompt({ includeDirect: false });

  const output = (await runPrompt(
    "ik wil vanmiddag van almere muziekwijk naar groningen. geef me directe treinopties."
  )) as {
    kind: string;
    trips?: Array<{ transfers?: unknown }>;
    directOnlyAlternatives?: {
      maxTransfers?: number;
      trips?: Array<{ transfers?: unknown }>;
    };
  };

  assert.equal(output.kind, "trips.search");
  assert.equal(output.trips?.length, 0);
  assert.equal(output.directOnlyAlternatives?.maxTransfers, 1);
  const altTransfers = Array.isArray(output.directOnlyAlternatives?.trips)
    ? output.directOnlyAlternatives?.trips.map((trip) => Number(trip.transfers ?? NaN))
    : [];
  assert.deepEqual(altTransfers, [1]);
});
