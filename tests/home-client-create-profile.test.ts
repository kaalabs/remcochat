import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCreateProfileRequestBody,
} from "../src/app/home-client-create-profile";

test("resolveCreateProfileRequestBody trims names and rejects blank input", () => {
  assert.deepEqual(
    resolveCreateProfileRequestBody({
      defaultModelId: "gpt-5",
      name: "  Alice  ",
      uiLanguage: "nl",
    }),
    {
      name: "Alice",
      defaultModelId: "gpt-5",
      uiLanguage: "nl",
    }
  );

  assert.equal(
    resolveCreateProfileRequestBody({
      defaultModelId: "gpt-5",
      name: "   ",
      uiLanguage: "en",
    }),
    null
  );
});
