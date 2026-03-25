import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSupportedProviderModel,
  requireModelTypeFromNpm,
  tryModelTypeFromNpm,
} from "../src/server/modelsdev";

test("modelsdev maps @ai-sdk/xai adapter to xai", () => {
  assert.equal(tryModelTypeFromNpm("@ai-sdk/xai"), "xai");
  assert.equal(requireModelTypeFromNpm("@ai-sdk/xai"), "xai");
});

test("modelsdev support filter respects curated E2E provider model lists", () => {
  assert.equal(
    isSupportedProviderModel({
      providerId: "e2e_alt",
      modelId: "gpt-5.2-codex",
      npm: "@ai-sdk/openai",
    }),
    true
  );
  assert.equal(
    isSupportedProviderModel({
      providerId: "e2e_alt",
      modelId: "codex-mini-latest",
      npm: "@ai-sdk/openai",
    }),
    false
  );
});
