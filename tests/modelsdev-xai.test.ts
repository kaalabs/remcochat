import assert from "node:assert/strict";
import { test } from "node:test";
import { requireModelTypeFromNpm, tryModelTypeFromNpm } from "../src/server/modelsdev";

test("modelsdev maps @ai-sdk/xai adapter to openai_compatible", () => {
  assert.equal(tryModelTypeFromNpm("@ai-sdk/xai"), "openai_compatible");
  assert.equal(requireModelTypeFromNpm("@ai-sdk/xai"), "openai_compatible");
});

