import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeProfileMemoryItems,
} from "../src/app/home-client-profile-memory";

test("normalizeProfileMemoryItems falls back to an empty array for invalid payloads", () => {
  assert.deepEqual(normalizeProfileMemoryItems(null), []);
  assert.deepEqual(normalizeProfileMemoryItems(undefined), []);
  assert.deepEqual(normalizeProfileMemoryItems({}), []);
  assert.deepEqual(
    normalizeProfileMemoryItems({ memory: "invalid" as never }),
    []
  );
});

test("normalizeProfileMemoryItems preserves valid memory arrays", () => {
  const memory = [
    {
      id: "memory-1",
      profileId: "profile-1",
      content: "Remember this",
      createdAt: "2026-03-26T11:00:00.000Z",
      updatedAt: "2026-03-26T11:00:00.000Z",
    },
  ];

  assert.deepEqual(normalizeProfileMemoryItems({ memory }), memory);
});
