import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCurrentDateTimeUserQuery,
  isTimezonesUserQuery,
} from "../src/server/timezones-intent";

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

test("isCurrentDateTimeUserQuery detects date questions", () => {
  assert.equal(isCurrentDateTimeUserQuery("What's today's date?"), true);
  assert.equal(isCurrentDateTimeUserQuery("Welke dag is het vandaag?"), true);
});

test("isCurrentDateTimeUserQuery ignores agenda scheduling prompts", () => {
  assert.equal(isCurrentDateTimeUserQuery("Plan een afspraak vandaag om 10:00"), false);
});
