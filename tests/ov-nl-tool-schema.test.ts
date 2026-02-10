import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { asSchema } from "ai";
import { createOvNlTools, __test__ as ovNlToolTest } from "../src/ai/ov-nl-tools";
import { _resetConfigCacheForTests } from "../src/server/config";

const ORIGINAL_CONFIG_PATH = process.env.REMCOCHAT_CONFIG_PATH;

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
  if (ORIGINAL_CONFIG_PATH === undefined) {
    delete process.env.REMCOCHAT_CONFIG_PATH;
  } else {
    process.env.REMCOCHAT_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
  }
});

test("ovNlGateway tool input schema serializes to JSON Schema type=object", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.ov_nl]
enabled = true
access = "localhost"

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`);

  process.env.REMCOCHAT_CONFIG_PATH = configPath;

  const req = new Request("http://localhost/api/chat", { headers: { host: "localhost" } });
  const tools = createOvNlTools({ request: req });

  assert.equal(tools.enabled, true);
  const ovNlGateway = (
    tools.tools as Record<string, { inputSchema: unknown }>
  ).ovNlGateway;
  assert.ok(ovNlGateway);

  const jsonSchema = await Promise.resolve(
    asSchema(ovNlGateway.inputSchema as Parameters<typeof asSchema>[0]).jsonSchema
  );
  assert.ok(jsonSchema && typeof jsonSchema === "object" && !Array.isArray(jsonSchema));
  const rootSchema = jsonSchema as Record<string, unknown>;
  assert.equal(rootSchema.type, "object");
  const argsSchema = (
    (rootSchema.properties as Record<string, unknown> | undefined)?.args as
      | Record<string, unknown>
      | undefined
  )?.type;
  assert.equal(argsSchema, "object");

  function* walkSchemaNodes(schema: unknown, at: string): Generator<[string, unknown]> {
    yield [at, schema];
    if (!schema || typeof schema !== "object") return;

    const schemaRecord = schema as Record<string, unknown>;

    if (schemaRecord.properties && typeof schemaRecord.properties === "object") {
      for (const [key, child] of Object.entries(
        schemaRecord.properties as Record<string, unknown>
      )) {
        yield* walkSchemaNodes(child, `${at}.properties.${key}`);
      }
    }

    if (schemaRecord.items) {
      yield* walkSchemaNodes(schemaRecord.items, `${at}.items`);
    }

    if (
      schemaRecord.additionalProperties &&
      typeof schemaRecord.additionalProperties === "object"
    ) {
      yield* walkSchemaNodes(
        schemaRecord.additionalProperties,
        `${at}.additionalProperties`
      );
    }

    for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
      const arr = schemaRecord[keyword];
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          yield* walkSchemaNodes(arr[i], `${at}.${keyword}[${i}]`);
        }
      }
    }
  }

  const emptyNodes: string[] = [];
  for (const [at, node] of walkSchemaNodes(jsonSchema, "$")) {
    if (
      node &&
      typeof node === "object" &&
      !Array.isArray(node) &&
      Object.keys(node).length === 0
    ) {
      emptyNodes.push(at);
    }
  }

  assert.deepEqual(emptyNodes, []);
});

test("ovNlGateway wire input schema accepts over-specified args payload", () => {
  const parsed = ovNlToolTest.OvNlGatewayToolWireInputSchema.safeParse({
    action: "stations.search",
    args: {
      query: "Almere Centrum",
      limit: 5,
      countryCodes: ["NL"],
      latitude: 0,
      longitude: 0,
      lat: 0,
      lng: 0,
      station: "x",
      stationCode: "x",
      uicCode: "x",
      dateTime: "x8chars..",
      maxJourneys: 1,
      lang: "nl",
      from: "x",
      to: "x",
      via: "x",
      searchForArrival: false,
      date: "x8chars..",
      ctxRecon: "x",
      id: "x",
      train: 1,
      departureUicCode: "x",
      transferUicCode: "x",
      arrivalUicCode: "x",
      omitCrowdForecast: true,
      type: "DISRUPTION",
      isActive: true,
      intent: {
        hard: {
          directOnly: true,
          maxTransfers: 0,
          excludeCancelled: true,
        },
        soft: {
          rankBy: ["fewest_transfers", "fastest"],
        },
      },
    },
  });

  assert.equal(parsed.success, true);
});

test("ovNlGateway validated schema keeps intent payload for trips.search", () => {
  const parsed = ovNlToolTest.OvNlGatewayToolValidatedInputSchema.parse({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      limit: 5,
      intent: {
        hard: {
          directOnly: true,
          maxTransfers: 0,
        },
        soft: {
          rankBy: ["fewest_transfers", "fastest"],
        },
      },
    },
  });

  assert.equal(parsed.action, "trips.search");
  assert.equal(parsed.args.intent?.hard?.directOnly, true);
  assert.equal(parsed.args.intent?.hard?.maxTransfers, 0);
  assert.deepEqual(parsed.args.intent?.soft?.rankBy, [
    "fewest_transfers",
    "fastest",
  ]);
});

test("ovNlGateway wire input schema accepts whitespace placeholders in optional fields", () => {
  const parsed = ovNlToolTest.OvNlGatewayToolWireInputSchema.safeParse({
    action: "trips.search",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      via: " ",
      ctxRecon: " ",
      departureUicCode: " ",
      transferUicCode: " ",
      arrivalUicCode: " ",
      dateTime: "2026-02-06T09:00:00+01:00",
    },
  });

  assert.equal(parsed.success, true);
});
