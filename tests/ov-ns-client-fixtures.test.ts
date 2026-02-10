import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  decodeArrivalsJson,
  decodeDeparturesJson,
  decodeDisruptionDetailJson,
  decodeDisruptionsByStationJson,
  decodeDisruptionsListJson,
  decodeJourneyDetailJson,
  decodeStationsNearestJson,
  decodeStationsSearchJson,
  decodeTripDetailJson,
  decodeTripsJson,
} from "../src/server/ov/ns-client";

function readFixture(name: string): unknown {
  const filePath = path.join(process.cwd(), "tests", "fixtures", "ns", name);
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

test("ns-client decodes stations.search fixture", () => {
  const json = readFixture("stations.search.json");
  const decoded = decodeStationsSearchJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(Array.isArray(decoded.payload));
  assert.ok(decoded.payload.length > 0);
});

test("ns-client decodes stations.nearest fixture", () => {
  const json = readFixture("stations.nearest.json");
  const decoded = decodeStationsNearestJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(Array.isArray(decoded.payload));
  assert.ok(decoded.payload.length > 0);
});

test("ns-client decodes departures fixture", () => {
  const json = readFixture("departures.json");
  const decoded = decodeDeparturesJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(decoded.payload && typeof decoded.payload === "object");
  const departures = (decoded.payload as { departures?: unknown }).departures;
  assert.ok(Array.isArray(departures));
});

test("ns-client decodes arrivals fixture", () => {
  const json = readFixture("arrivals.json");
  const decoded = decodeArrivalsJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(decoded.payload && typeof decoded.payload === "object");
  const arrivals = (decoded.payload as { arrivals?: unknown }).arrivals;
  assert.ok(Array.isArray(arrivals));
});

test("ns-client decodes trips fixture", () => {
  const json = readFixture("trips.json");
  const decoded = decodeTripsJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(Array.isArray(decoded.payload));
  assert.ok(decoded.payload.length > 0);
});

test("ns-client decodes trip.detail fixture", () => {
  const json = readFixture("trip.detail.json");
  const decoded = decodeTripDetailJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(decoded.payload && typeof decoded.payload === "object");
});

test("ns-client decodes journey.detail fixture", () => {
  const json = readFixture("journey.detail.json");
  const decoded = decodeJourneyDetailJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(decoded.payload && typeof decoded.payload === "object");
});

test("ns-client decodes disruptions.list fixture", () => {
  const json = readFixture("disruptions.list.json");
  const decoded = decodeDisruptionsListJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(Array.isArray(decoded.payload));
});

test("ns-client decodes disruptions.by_station fixture", () => {
  const json = readFixture("disruptions.by_station.json");
  const decoded = decodeDisruptionsByStationJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(Array.isArray(decoded.payload));
});

test("ns-client decodes disruptions.detail fixture", () => {
  const json = readFixture("disruptions.detail.json");
  const decoded = decodeDisruptionDetailJson(json);
  assert.equal(decoded.ok, true);
  assert.ok(decoded.payload && typeof decoded.payload === "object");
});
