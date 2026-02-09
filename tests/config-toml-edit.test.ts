import assert from "node:assert/strict";
import { test } from "node:test";
import {
  updateProviderDefaultModelIdInToml,
  updateProviderAllowedModelIdsInToml,
  updateRouterModelIdInToml,
  updateWebToolsSearchProviderInToml,
} from "../src/server/config-toml-edit";

test("updateProviderAllowedModelIdsInToml replaces only the target provider allowed_model_ids", () => {
  const original = `
version = 2

[app]
default_provider_id = "opencode"

[app.router]
enabled = true
provider_id = "opencode"
model_id = "a"
min_confidence = 0.7
max_input_chars = 600

[providers.opencode]
name = "OpenCode Zen"
api_key_env = "OPENCODE_API_KEY"
base_url = "https://example.com"
default_model_id = "a"
allowed_model_ids = [
  # keep comments intact
  "a",
  "b",
]

[providers.vercel]
name = "Vercel"
api_key_env = "VERCEL_API_KEY"
base_url = "https://vercel.example"
default_model_id = "openai/gpt-4o-mini"
allowed_model_ids = ["openai/gpt-4o-mini"]
`;

  const updated = updateProviderAllowedModelIdsInToml(original, "opencode", [
    "a",
    "c",
  ]);

  assert.match(
    updated,
    /allowed_model_ids = \[\n\s+"a",\n\s+"c",\n\s*\]/m
  );
  assert.match(updated, /\[providers\.vercel\][\s\S]*allowed_model_ids = \["openai\/gpt-4o-mini"\]/m);
});

test("updateRouterModelIdInToml replaces app.router.model_id", () => {
  const original = `
version = 2

[app]
default_provider_id = "opencode"

[app.router]
enabled = true
provider_id = "opencode"
model_id = "old"
min_confidence = 0.7
max_input_chars = 600

[providers.opencode]
name = "OpenCode Zen"
api_key_env = "OPENCODE_API_KEY"
base_url = "https://example.com"
default_model_id = "old"
allowed_model_ids = ["old"]
`;

  const updated = updateRouterModelIdInToml(original, "new-model");
  assert.match(updated, /^\s*model_id = "new-model"\s*$/m);
  assert.doesNotMatch(updated, /^\s*model_id = "old"\s*$/m);
});

test("updateProviderDefaultModelIdInToml replaces providers.<id>.default_model_id", () => {
  const original = `
version = 2

[app]
default_provider_id = "opencode"

[providers.opencode]
name = "OpenCode Zen"
api_key_env = "OPENCODE_API_KEY"
base_url = "https://example.com"
default_model_id = "old"
allowed_model_ids = ["old"]
`;

  const updated = updateProviderDefaultModelIdInToml(original, "opencode", "new-default");
  assert.match(updated, /^\s*default_model_id = "new-default"\s*$/m);
  assert.doesNotMatch(updated, /^\s*default_model_id = "old"\s*$/m);
});

test("updateProviderAllowedModelIdsInToml throws when provider table missing", () => {
  assert.throws(
    () => updateProviderAllowedModelIdsInToml("version = 2\n", "missing", ["a"]),
    /missing table \[providers\.missing\]/
  );
});

test("updateWebToolsSearchProviderInToml replaces existing search_provider", () => {
  const original = `
version = 2

[app]
default_provider_id = "opencode"

[app.web_tools]
enabled = true
search_provider = "exa"
max_results = 8
`;

  const updated = updateWebToolsSearchProviderInToml(original, "brave");
  assert.match(updated, /^\s*search_provider = "brave"\s*$/m);
  assert.doesNotMatch(updated, /^\s*search_provider = "exa"\s*$/m);
});

test("updateWebToolsSearchProviderInToml inserts missing search_provider", () => {
  const original = `
version = 2

[app]
default_provider_id = "opencode"

[app.web_tools]
enabled = true
max_results = 8
`;

  const updated = updateWebToolsSearchProviderInToml(original, "brave");
  assert.match(updated, /\[app\.web_tools\]\nsearch_provider = "brave"\nenabled = true/m);
});

test("updateWebToolsSearchProviderInToml throws when app.web_tools is missing", () => {
  assert.throws(
    () => updateWebToolsSearchProviderInToml("version = 2\n", "exa"),
    /missing table \[app\.web_tools\]/
  );
});
