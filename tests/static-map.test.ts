import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOpenStreetMapDeStaticMapUrl,
  buildStadiaStaticMapUrl,
} from "../src/lib/static-map";

test("buildStadiaStaticMapUrl includes center, size, and marker", () => {
  const url = buildStadiaStaticMapUrl({
    latitude: 37.7749,
    longitude: -122.4194,
    size: { width: 400, height: 150 },
  });
  assert.ok(url.startsWith("https://tiles.stadiamaps.com/static/alidade_smooth.png?"));
  assert.match(url, /center=37\.7749%2C-122\.4194/);
  assert.match(url, /size=400x150%402x/);
  assert.match(url, /markers=37\.7749%2C-122\.4194/);
});

test("buildStadiaStaticMapUrl includes api_key when provided", () => {
  const url = buildStadiaStaticMapUrl({
    latitude: 1,
    longitude: 2,
    size: { width: 10, height: 20 },
    apiKey: "test-key",
  });
  assert.match(url, /api_key=test-key/);
});

test("buildOpenStreetMapDeStaticMapUrl includes center, size, and marker", () => {
  const url = buildOpenStreetMapDeStaticMapUrl({
    latitude: 37.7749,
    longitude: -122.4194,
    size: { width: 400, height: 150 },
  });
  assert.ok(url.startsWith("https://staticmap.openstreetmap.de/staticmap.php?"));
  assert.match(url, /center=37\.7749%2C-122\.4194/);
  assert.match(url, /size=400x150/);
  assert.match(url, /markers=37\.7749%2C-122\.4194%2Col-marker/);
});

