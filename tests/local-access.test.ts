import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseConfigToml } from "../src/server/config";
import { requireLocalCommandAllowed, requireLocalPathAllowed } from "../src/server/local-access";

function baseConfigToml(extra: string) {
  return `
version = 2

[app]
default_provider_id = "vercel"
${extra}

[providers.vercel]
name = "Vercel AI Gateway"
api_key_env = "VERCEL_AI_GATEWAY_API_KEY"
base_url = "https://ai-gateway.vercel.sh/v3/ai"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`;
}

test("requireLocalCommandAllowed is a no-op when local_access is disabled", () => {
  const cfg = parseConfigToml(baseConfigToml(""));
  requireLocalCommandAllowed({ cfg, command: "modelsdev", feature: "test" });
});

test("requireLocalCommandAllowed blocks when allowlist is empty", () => {
  const cfg = parseConfigToml(
    baseConfigToml(`

[app.local_access]
enabled = true
allowed_commands = []
allowed_directories = ["*"]
`)
  );

  assert.throws(() => {
    requireLocalCommandAllowed({ cfg, command: "modelsdev", feature: "test" });
  });
});

test("requireLocalCommandAllowed allows only allowlisted commands", () => {
  const cfg = parseConfigToml(
    baseConfigToml(`

[app.local_access]
enabled = true
allowed_commands = ["modelsdev"]
allowed_directories = ["*"]
`)
  );

  requireLocalCommandAllowed({ cfg, command: "modelsdev", feature: "test" });
  assert.throws(() => {
    requireLocalCommandAllowed({ cfg, command: "git", feature: "test" });
  });
});

test("requireLocalPathAllowed allows only allowlisted directories", () => {
  const allowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remcochat-allow-"));
  const denyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remcochat-deny-"));

  const cfg = parseConfigToml(
    baseConfigToml(`

[app.local_access]
enabled = true
allowed_commands = ["*"]
allowed_directories = ["${allowRoot.replace(/\\/g, "\\\\")}"]
`)
  );

  requireLocalPathAllowed({
    cfg,
    localPath: path.join(allowRoot, "nested", "file.txt"),
    feature: "test",
    operation: "read",
  });

  assert.throws(() => {
    requireLocalPathAllowed({
      cfg,
      localPath: path.join(denyRoot, "file.txt"),
      feature: "test",
      operation: "read",
    });
  });
});

