import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHomeClientOpeningMessagePrefetchSearchParams,
  isHomeClientInaccessibleChatError,
} from "../src/app/home-client-page-controller";

test("buildHomeClientOpeningMessagePrefetchSearchParams keeps the language and combined exclude list", () => {
  const params = buildHomeClientOpeningMessagePrefetchSearchParams({
    displayed: "  Hello there  ",
    nextQueued: "  Ask me anything  ",
    uiLanguage: "en",
  });

  assert.equal(params.get("lang"), "en");
  assert.equal(params.get("exclude"), "Hello there,Ask me anything");
});

test("buildHomeClientOpeningMessagePrefetchSearchParams omits exclude when both values are empty", () => {
  const params = buildHomeClientOpeningMessagePrefetchSearchParams({
    displayed: "   ",
    nextQueued: "",
    uiLanguage: "nl",
  });

  assert.equal(params.get("lang"), "nl");
  assert.equal(params.has("exclude"), false);
});

test("isHomeClientInaccessibleChatError matches inaccessible errors case-insensitively", () => {
  assert.equal(
    isHomeClientInaccessibleChatError(
      new Error("This chat is NOT ACCESSIBLE for this profile")
    ),
    true
  );
  assert.equal(
    isHomeClientInaccessibleChatError({
      message: "no longer not accessible for viewer",
    }),
    true
  );
});

test("isHomeClientInaccessibleChatError ignores unrelated or empty errors", () => {
  assert.equal(isHomeClientInaccessibleChatError(new Error("boom")), false);
  assert.equal(isHomeClientInaccessibleChatError(null), false);
  assert.equal(isHomeClientInaccessibleChatError(undefined), false);
});
