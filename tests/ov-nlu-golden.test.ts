import assert from "node:assert/strict";
import { test } from "node:test";
import { extractOvQueryFromUserText } from "../src/server/ov/nlu";
import { runOvFromUserText } from "../src/server/ov/runner";

test("OV NLU: departure board routes deterministically (Almere Muziekwijk)", async () => {
  const prompt = "laat het vertrekbord van station almere muziekwijk zien";
  const result = await extractOvQueryFromUserText({ text: prompt });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.query.intentKind, "departures.list");
  assert.equal(result.query.confidence, 0.95);
  assert.ok((result.query.slots.stationText ?? "").toLowerCase().includes("almere muziekwijk"));

  const planned = await runOvFromUserText({ text: prompt });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.action, "departures.list");
  assert.ok(String(planned.args.station ?? "").toLowerCase().includes("almere muziekwijk"));
});

test("OV NLU: departure board routes deterministically (Almere Centrum) without 'station' keyword", async () => {
  const prompt = "geef het vertrektijdenbord van Almere Centrum";
  const result = await extractOvQueryFromUserText({ text: prompt });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.query.intentKind, "departures.list");
  assert.equal(result.query.confidence, 0.95);
  assert.ok((result.query.slots.stationText ?? "").toLowerCase().includes("almere centrum"));

  const planned = await runOvFromUserText({ text: prompt });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.action, "departures.list");
  assert.ok(String(planned.args.station ?? "").toLowerCase().includes("almere centrum"));
});

test('OV NLU: trips.search strips date hints from "to" station and sets dateTimeHint', async () => {
  const prompt =
    "ik wil van almere muziekwijk naar amsterdam centraal vandaag. geef me treinopties";
  const result = await extractOvQueryFromUserText({ text: prompt });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.query.intentKind, "trips.search");
  assert.equal(result.query.confidence, 0.95);

  assert.ok((result.query.slots.fromText ?? "").toLowerCase().includes("almere muziekwijk"));
  assert.equal((result.query.slots.toText ?? "").toLowerCase(), "amsterdam centraal");
  assert.equal(result.query.slots.dateTimeHint, "today");

  const hard = result.query.requested.hard as Record<string, unknown> | undefined;
  assert.notEqual(hard?.directOnly, true);
  if (typeof hard?.maxTransfers === "number") {
    assert.ok(!(Number.isFinite(hard.maxTransfers) && hard.maxTransfers <= 0));
  }

  const planned = await runOvFromUserText({ text: prompt });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.action, "trips.search");
  assert.ok(String(planned.args.from ?? "").toLowerCase().includes("almere muziekwijk"));
  assert.equal(String(planned.args.to ?? "").toLowerCase(), "amsterdam centraal");
  assert.equal(String(planned.args.dateTime ?? ""), "today");
});
