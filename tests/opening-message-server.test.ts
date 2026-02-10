import assert from "node:assert/strict";
import { test } from "node:test";
import {
  __test__,
  getOpeningMessage,
  OPENING_MESSAGE_FALLBACKS,
  sanitizeOpeningMessage,
} from "../src/server/opening-message";

test("sanitizeOpeningMessage strips markdown and enforces sentence output", () => {
  assert.equal(
    sanitizeOpeningMessage("**Hello there**"),
    "Hello there."
  );
  assert.equal(
    sanitizeOpeningMessage("'One line opener'"),
    "One line opener."
  );
  assert.equal(sanitizeOpeningMessage("https://example.com"), null);
  assert.equal(sanitizeOpeningMessage(""), null);
});

test("getOpeningMessage respects exclude and rotates the pool", async () => {
  __test__.clearPools();
  __test__.setPool("en", [
    "Alpha opener.",
    "Beta opener.",
    "Gamma opener.",
  ]);

  const first = await getOpeningMessage(
    { lang: "en", exclude: ["Alpha opener."] },
    { generateBatch: async () => [] }
  );
  assert.equal(first.source, "pool");
  assert.equal(first.message, "Beta opener.");

  const poolAfterFirst = __test__.getPool("en");
  assert.equal(poolAfterFirst[0], "Alpha opener.");
  assert.equal(poolAfterFirst[1], "Gamma opener.");
  assert.equal(poolAfterFirst[poolAfterFirst.length - 1], "Beta opener.");
});

test("getOpeningMessage refills from generator and dedupes", async () => {
  __test__.clearPools();

  const result = await getOpeningMessage(
    { lang: "en", exclude: ["Tap a key and I will do cartwheels."] },
    {
      generateBatch: async () => [
        "Tap a key and I will do cartwheels.",
        "Tap a key and I will do cartwheels.",
        "Give me a puzzle and I will smile in binary.",
        "https://example.com",
        "",
      ],
    }
  );

  assert.equal(result.source, "pool");
  assert.equal(result.message, "Give me a puzzle and I will smile in binary.");
});

test("getOpeningMessage returns fallback when pool cannot provide non-excluded entries", async () => {
  __test__.clearPools();

  const excluded = OPENING_MESSAGE_FALLBACKS.en.map((entry) => entry);
  const result = await getOpeningMessage(
    { lang: "en", exclude: excluded },
    { generateBatch: async () => [] }
  );

  assert.equal(result.lang, "en");
  assert.equal(result.source, "fallback");
  assert.ok(result.message.length > 0);
});

test("opening message fallback map covers current languages", () => {
  assert.deepEqual(Object.keys(OPENING_MESSAGE_FALLBACKS).sort(), ["en", "nl"]);
  assert.ok(OPENING_MESSAGE_FALLBACKS.en.length > 0);
  assert.ok(OPENING_MESSAGE_FALLBACKS.nl.length > 0);
});
