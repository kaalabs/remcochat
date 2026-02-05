import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { asSchema } from "ai";
import { createHueGatewayTools } from "../src/ai/hue-gateway-tools";
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

test("hueGateway tool input schema serializes to JSON Schema type=object", async () => {
  const configPath = writeTempConfigToml(`
version = 2

[app]
default_provider_id = "vercel"

[app.hue_gateway]
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
  const tools = createHueGatewayTools({
    request: req,
    isTemporary: true,
    skillRelevant: true,
    temporarySessionId: "tmp",
    turnUserMessageId: "msg-1",
  });

  assert.equal(tools.enabled, true);
  const hueGateway = (tools.tools as any).hueGateway;
  assert.ok(hueGateway);

  const jsonSchema = await Promise.resolve(asSchema(hueGateway.inputSchema).jsonSchema);
  assert.equal(jsonSchema.type, "object");
  assert.equal(jsonSchema.properties?.args?.type, "object");

  function* walkSchemaNodes(schema: any, at: string): Generator<[string, any]> {
    yield [at, schema];
    if (!schema || typeof schema !== "object") return;

    if (schema.properties && typeof schema.properties === "object") {
      for (const [key, child] of Object.entries(schema.properties)) {
        yield* walkSchemaNodes(child, `${at}.properties.${key}`);
      }
    }

    if (schema.items) {
      yield* walkSchemaNodes(schema.items, `${at}.items`);
    }

    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      yield* walkSchemaNodes(schema.additionalProperties, `${at}.additionalProperties`);
    }

    for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
      const arr = schema[keyword];
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          yield* walkSchemaNodes(arr[i], `${at}.${keyword}[${i}]`);
        }
      }
    }

    for (const keyword of ["not", "if", "then", "else", "contains"] as const) {
      const child = schema[keyword];
      if (child && typeof child === "object") {
        yield* walkSchemaNodes(child, `${at}.${keyword}`);
      }
    }
  }

  const emptyNodes: string[] = [];
  for (const [at, node] of walkSchemaNodes(jsonSchema, "$")) {
    if (node && typeof node === "object" && !Array.isArray(node) && Object.keys(node).length === 0) {
      emptyNodes.push(at);
    }
  }

  assert.deepEqual(emptyNodes, []);
});
