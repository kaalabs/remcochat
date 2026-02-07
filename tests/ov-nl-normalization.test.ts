import assert from "node:assert/strict";
import { test } from "node:test";
import { __test__ } from "../src/ai/ov-nl-tools";

test("normalizes station payload fields", () => {
  const station = __test__.normalizeStation({
    code: "ut",
    UICCode: "8400621",
    land: "nl",
    namen: {
      kort: "Utrecht C.",
      middel: "Utrecht Centraal",
      lang: "Utrecht Centraal",
    },
    lat: 52.089,
    lng: 5.11,
    distance: 123.4,
  });

  assert.equal(station.code, "UT");
  assert.equal(station.uicCode, "8400621");
  assert.equal(station.nameMedium, "Utrecht Centraal");
  assert.equal(station.countryCode, "NL");
  assert.equal(station.lat, 52.089);
  assert.equal(station.lng, 5.11);
  assert.equal(station.distanceMeters, 123.4);
});

test("normalizes trip summary with legs", () => {
  const summary = __test__.normalizeTripSummary(
    {
      uid: "trip-1",
      ctxRecon: "ctx-1",
      status: "NORMAL",
      transfers: 1,
      plannedDurationInMinutes: 99,
      actualDurationInMinutes: 101,
      optimal: true,
      realtime: true,
      legs: [
        {
          idx: "0",
          travelType: "PUBLIC_TRANSIT",
          name: "NS Intercity",
          origin: {
            name: "Almere Centrum",
            plannedDateTime: "2026-02-06T13:33:00+01:00",
            actualDateTime: "2026-02-06T13:33:00+01:00",
            plannedTrack: "4",
          },
          destination: {
            name: "Groningen",
            plannedDateTime: "2026-02-06T15:12:00+01:00",
            actualDateTime: "2026-02-06T15:12:00+01:00",
            plannedTrack: "4",
          },
          stops: [{}, {}, {}],
        },
      ],
      messages: [{ head: "Info", text: "Geen bijzonderheden" }],
      primaryMessage: { title: "Normale dienstregeling" },
    },
    "HARP"
  );

  assert.equal(summary.uid, "trip-1");
  assert.equal(summary.ctxRecon, "ctx-1");
  assert.equal(summary.status, "NORMAL");
  assert.equal(summary.source, "HARP");
  assert.equal(summary.departureName, "Almere Centrum");
  assert.equal(summary.arrivalName, "Groningen");
  assert.equal(summary.transfers, 1);
  assert.equal(summary.legs.length, 1);
  assert.equal(summary.legs[0]?.mode, "PUBLIC_TRANSIT");
  assert.equal(summary.legs[0]?.stopCount, 3);
  assert.equal(summary.primaryMessage, "Normale dienstregeling");
});

test("normalizes journey payload to timeline legs", () => {
  const legs = __test__.normalizeJourneyLegs(
    {
      stops: [
        {
          destination: "Groningen",
          stop: { code: "UT" },
          departures: [
            {
              plannedTime: "2026-02-06T13:33:00+01:00",
              actualTime: "2026-02-06T13:34:00+01:00",
              plannedTrack: "4",
              actualTrack: "4",
              product: { displayName: "NS Intercity" },
            },
          ],
        },
        {
          stop: { code: "AMF" },
          arrivals: [
            {
              plannedTime: "2026-02-06T13:50:00+01:00",
              actualTime: "2026-02-06T13:50:00+01:00",
              plannedTrack: "6",
              actualTrack: "6",
            },
          ],
        },
      ],
    },
    "journey-1"
  );

  assert.equal(legs.length, 1);
  assert.equal(legs[0]?.originName, "UT");
  assert.equal(legs[0]?.destinationName, "AMF");
  assert.equal(legs[0]?.journeyDetailRef, "journey-1");
});
