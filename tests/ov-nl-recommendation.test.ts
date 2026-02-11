import assert from "node:assert/strict";
import { test } from "node:test";
import { pickRecommendedTrip, pickRecommendedTripUidForSearch } from "../src/lib/ov-nl-recommendation";

function trip(uid: string, overrides: Partial<any> = {}) {
  return {
    uid,
    optimal: false,
    transfers: 0,
    plannedDurationMinutes: null,
    actualDurationMinutes: null,
    departurePlannedDateTime: null,
    departureActualDateTime: null,
    arrivalPlannedDateTime: null,
    arrivalActualDateTime: null,
    ...overrides,
  };
}

test("pickRecommendedTrip uses tool/NS ordering (first)", () => {
  const a = trip("A", { transfers: 0, plannedDurationMinutes: 80 });
  const b = trip("B", { transfers: 1, plannedDurationMinutes: 35 });

  assert.equal(pickRecommendedTrip([b, a])?.uid, "B");
  assert.equal(pickRecommendedTrip([b, a].map((t) => (t.uid === "A" ? { ...t, optimal: true } : t)))?.uid, "B");
});

test("pickRecommendedTripUidForSearch uses primary trips when present", () => {
  const primary = [trip("P1"), trip("P2")];
  const alternatives = [trip("A1"), trip("A2")];

  assert.equal(
    pickRecommendedTripUidForSearch({ primaryTrips: primary, alternativeTrips: alternatives }),
    "P1"
  );
});

test("pickRecommendedTripUidForSearch falls back to alternatives when primary empty", () => {
  const alternatives = [trip("A1"), trip("A2")];

  assert.equal(
    pickRecommendedTripUidForSearch({ primaryTrips: [], alternativeTrips: alternatives }),
    "A1"
  );
});
