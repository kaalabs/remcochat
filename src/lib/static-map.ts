export type StaticMapSize = {
  width: number;
  height: number;
};

export type StaticMapRequest = {
  latitude: number;
  longitude: number;
  zoom?: number;
  size: StaticMapSize;
};

function assertFiniteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}

export function buildStadiaStaticMapUrl(
  input: StaticMapRequest & { apiKey?: string }
): string {
  assertFiniteNumber(input.latitude, "latitude");
  assertFiniteNumber(input.longitude, "longitude");

  const zoom = Math.min(20, Math.max(0, Math.floor(input.zoom ?? 12)));
  const width = Math.max(1, Math.floor(input.size.width));
  const height = Math.max(1, Math.floor(input.size.height));

  const url = new URL("https://tiles.stadiamaps.com/static/alidade_smooth.png");
  url.searchParams.set("center", `${input.latitude},${input.longitude}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", `${width}x${height}@2x`);
  url.searchParams.set("markers", `${input.latitude},${input.longitude}`);
  if (input.apiKey) url.searchParams.set("api_key", input.apiKey);
  return url.toString();
}

export function buildOpenStreetMapDeStaticMapUrl(
  input: StaticMapRequest
): string {
  assertFiniteNumber(input.latitude, "latitude");
  assertFiniteNumber(input.longitude, "longitude");

  const zoom = Math.min(20, Math.max(0, Math.floor(input.zoom ?? 12)));
  const width = Math.max(1, Math.floor(input.size.width));
  const height = Math.max(1, Math.floor(input.size.height));

  const url = new URL("https://staticmap.openstreetmap.de/staticmap.php");
  url.searchParams.set("center", `${input.latitude},${input.longitude}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", `${width}x${height}`);
  url.searchParams.set(
    "markers",
    `${input.latitude},${input.longitude},ol-marker`
  );
  return url.toString();
}

