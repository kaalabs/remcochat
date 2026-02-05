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
});

