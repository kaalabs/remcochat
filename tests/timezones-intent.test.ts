import assert from "node:assert/strict";
import { test } from "node:test";
import { isTimezonesUserQuery } from "../src/server/timezones-intent";

test("isTimezonesUserQuery detects explicit timezone/time questions", () => {
  assert.equal(isTimezonesUserQuery("What time is it in Tokyo right now?"), true);
  assert.equal(isTimezonesUserQuery("Convert 09:30 PST to CET"), true);
  assert.equal(isTimezonesUserQuery("Hoe laat is het nu in Amsterdam?"), true);
  assert.equal(isTimezonesUserQuery("tijdzones"), true);
});

test("isTimezonesUserQuery ignores agenda scheduling prompts", () => {
  assert.equal(isTimezonesUserQuery("Save a new agenda item for tomorrow at 10"), false);
  assert.equal(isTimezonesUserQuery("Voeg een afspraak toe aan mijn agenda morgen"), false);
});
