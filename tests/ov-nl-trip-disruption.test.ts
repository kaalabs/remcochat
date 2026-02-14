import assert from "node:assert/strict";
import { test } from "node:test";
import type { OvNlTripLeg, OvNlTripSummary } from "../src/lib/types";
import { legHasDisruption, tripHasLegDisruptions } from "../src/lib/ov-nl-trip-disruption";

function makeLeg(overrides?: Partial<OvNlTripLeg>): OvNlTripLeg {
  return {
    index: "0",
    mode: "PUBLIC_TRANSIT",
    name: "Train",
    direction: "North",
    cancelled: false,
    originName: "UT",
    originPlannedDateTime: "2026-02-06T10:00:00Z",
    originActualDateTime: "2026-02-06T10:00:00Z",
    originPlannedTrack: "1",
    originActualTrack: "1",
    destinationName: "GR",
    destinationPlannedDateTime: "2026-02-06T11:00:00Z",
    destinationActualDateTime: "2026-02-06T11:00:00Z",
    destinationPlannedTrack: "2",
    destinationActualTrack: "2",
    journeyDetailRef: null,
    messages: [],
    stopCount: 0,
    ...overrides,
  };
}

function makeTrip(overrides?: Partial<OvNlTripSummary>): OvNlTripSummary {
  const legs = overrides?.legs ?? [makeLeg()];
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  return {
    uid: "trip-1",
    status: "NORMAL",
    source: "HARP",
    optimal: true,
    realtime: true,
    transfers: 0,
    plannedDurationMinutes: 60,
    actualDurationMinutes: 60,
    departureName: first.originName,
    departurePlannedDateTime: first.originPlannedDateTime,
    departureActualDateTime: first.originActualDateTime,
    arrivalName: last.destinationName,
    arrivalPlannedDateTime: last.destinationPlannedDateTime,
    arrivalActualDateTime: last.destinationActualDateTime,
    primaryMessage: null,
    messages: [],
    ctxRecon: "ctx-1",
    routeId: null,
    legs,
    ...overrides,
  };
}

test("legHasDisruption returns false for clean leg", () => {
  assert.equal(legHasDisruption(makeLeg()), false);
});

test("legHasDisruption returns true for cancelled leg", () => {
  assert.equal(legHasDisruption(makeLeg({ cancelled: true })), true);
});

test("legHasDisruption returns true for leg messages", () => {
  assert.equal(legHasDisruption(makeLeg({ messages: ["Storing op het traject"] })), true);
});

test("legHasDisruption returns true for significant delay", () => {
  assert.equal(
    legHasDisruption(
      makeLeg({
        originPlannedDateTime: "2026-02-06T10:00:00Z",
        originActualDateTime: "2026-02-06T10:03:00Z",
      })
    ),
    true
  );
});

test("legHasDisruption returns true for track change", () => {
  assert.equal(legHasDisruption(makeLeg({ originActualTrack: "3" })), true);
});

test("tripHasLegDisruptions returns true when any leg is disrupted", () => {
  assert.equal(tripHasLegDisruptions(makeTrip({ legs: [makeLeg({ cancelled: true })] })), true);
});

test("tripHasLegDisruptions returns true for cancelled status even without leg signals", () => {
  assert.equal(tripHasLegDisruptions(makeTrip({ status: "CANCELLED" })), true);
});

test("tripHasLegDisruptions returns false when no legs have disruption signals", () => {
  assert.equal(tripHasLegDisruptions(makeTrip()), false);
});

