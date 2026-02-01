import { buildStadiaStaticMapUrl } from "@/lib/static-map";
import { NextResponse } from "next/server";
import dns from "node:dns";
import { PNG } from "pngjs";

export const runtime = "nodejs";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Best-effort: older runtimes may not support this.
}

function parseFiniteNumber(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

type SafeErrorDetails = {
  name?: string;
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number | string;
  cause?: SafeErrorDetails;
};

function safeErrorDetails(err: unknown): SafeErrorDetails {
  if (!(err instanceof Error)) return { message: String(err) };
  const anyErr = err as Error & {
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    hostname?: unknown;
    address?: unknown;
    port?: unknown;
    cause?: unknown;
  };
  return {
    name: anyErr.name,
    message: anyErr.message,
    code: typeof anyErr.code === "string" ? anyErr.code : undefined,
    errno: typeof anyErr.errno === "number" ? anyErr.errno : undefined,
    syscall: typeof anyErr.syscall === "string" ? anyErr.syscall : undefined,
    hostname: typeof anyErr.hostname === "string" ? anyErr.hostname : undefined,
    address: typeof anyErr.address === "string" ? anyErr.address : undefined,
    port:
      typeof anyErr.port === "number"
        ? anyErr.port
        : typeof anyErr.port === "string"
          ? anyErr.port
          : undefined,
    cause: anyErr.cause ? safeErrorDetails(anyErr.cause) : undefined,
  };
}

async function fetchImage(url: string, headers: Record<string, string>) {
  const res = await fetch(url, {
    headers,
    // Avoid hanging the whole tool card if the provider is blocked/unreachable.
    signal: AbortSignal.timeout(7_000),
    cache: "force-cache",
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!res.ok) {
    throw new Error(`Upstream map provider failed (${res.status}).`);
  }

  const contentType = res.headers.get("content-type") || "image/png";
  const bytes = await res.arrayBuffer();
  return { contentType, bytes };
}

function lonLatToWorldPixel(input: { lon: number; lat: number; zoom: number }) {
  const lat = Math.max(-85.05112878, Math.min(85.05112878, input.lat));
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** input.zoom;
  const worldSize = n * 256;
  const x = ((input.lon + 180) / 360) * worldSize;
  const y =
    (1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
    2 *
    worldSize;
  return { x, y, worldSize };
}

function wrapTileX(x: number, zoom: number) {
  const n = 2 ** zoom;
  const wrapped = ((x % n) + n) % n;
  return wrapped;
}

async function fetchOsmTilePng(input: {
  z: number;
  x: number;
  y: number;
  headers: Record<string, string>;
}) {
  const url = `https://tile.openstreetmap.org/${input.z}/${input.x}/${input.y}.png`;
  const res = await fetch(url, {
    headers: input.headers,
    signal: AbortSignal.timeout(7_000),
    cache: "force-cache",
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!res.ok) {
    throw new Error(`OSM tile fetch failed (${res.status}).`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return PNG.sync.read(bytes);
}

async function renderOsmStaticMapPng(input: {
  latitude: number;
  longitude: number;
  zoom: number;
  width: number;
  height: number;
  headers: Record<string, string>;
}) {
  const { x: worldX, y: worldY } = lonLatToWorldPixel({
    lon: input.longitude,
    lat: input.latitude,
    zoom: input.zoom,
  });

  const startX = Math.round(worldX - input.width / 2);
  const startY = Math.round(worldY - input.height / 2);

  const minTileX = Math.floor(startX / 256);
  const maxTileX = Math.floor((startX + input.width - 1) / 256);
  const minTileY = Math.floor(startY / 256);
  const maxTileY = Math.floor((startY + input.height - 1) / 256);

  const out = new PNG({ width: input.width, height: input.height });

  for (let ty = minTileY; ty <= maxTileY; ty++) {
    if (ty < 0 || ty >= 2 ** input.zoom) continue;
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const wrappedX = wrapTileX(tx, input.zoom);
      const tile = await fetchOsmTilePng({
        z: input.zoom,
        x: wrappedX,
        y: ty,
        headers: input.headers,
      });

      const tileMinX = tx * 256;
      const tileMinY = ty * 256;
      const x0 = Math.max(startX, tileMinX);
      const y0 = Math.max(startY, tileMinY);
      const x1 = Math.min(startX + input.width, tileMinX + 256);
      const y1 = Math.min(startY + input.height, tileMinY + 256);

      for (let y = y0; y < y1; y++) {
        const outY = y - startY;
        const srcY = y - tileMinY;
        for (let x = x0; x < x1; x++) {
          const outX = x - startX;
          const srcX = x - tileMinX;
          const srcIdx = (srcY * 256 + srcX) * 4;
          const outIdx = (outY * input.width + outX) * 4;
          out.data[outIdx] = tile.data[srcIdx];
          out.data[outIdx + 1] = tile.data[srcIdx + 1];
          out.data[outIdx + 2] = tile.data[srcIdx + 2];
          out.data[outIdx + 3] = 255;
        }
      }
    }
  }

  // Simple marker at the map center.
  const cx = Math.floor(input.width / 2);
  const cy = Math.floor(input.height / 2);
  const outerR = 6;
  const innerR = 4;
  for (let dy = -outerR; dy <= outerR; dy++) {
    for (let dx = -outerR; dx <= outerR; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= input.width || y >= input.height) continue;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > outerR * outerR) continue;
      const idx = (y * input.width + x) * 4;
      const isInner = dist2 <= innerR * innerR;
      if (isInner) {
        out.data[idx] = 220;
        out.data[idx + 1] = 38;
        out.data[idx + 2] = 38;
        out.data[idx + 3] = 255;
      } else {
        out.data[idx] = 255;
        out.data[idx + 1] = 255;
        out.data[idx + 2] = 255;
        out.data[idx + 3] = 220;
      }
    }
  }

  return PNG.sync.write(out);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const latitude = parseFiniteNumber(searchParams.get("lat"));
  const longitude = parseFiniteNumber(searchParams.get("lon"));
  if (latitude === null || longitude === null) {
    return NextResponse.json(
      { error: 'Missing or invalid "lat"/"lon".' },
      { status: 400 }
    );
  }

  const zoom = clampInt(parseFiniteNumber(searchParams.get("zoom")) ?? 12, 0, 20);
  const width = clampInt(parseFiniteNumber(searchParams.get("w")) ?? 400, 1, 1024);
  const height = clampInt(parseFiniteNumber(searchParams.get("h")) ?? 150, 1, 1024);

  const size = { width, height };

  const stadiaApiKey =
    process.env.STADIA_MAPS_API_KEY || process.env.NEXT_PUBLIC_STADIA_MAPS_API_KEY;

  // OSM tile/static services generally expect a real, identifying User-Agent; some providers will
  // throttle/block generic library defaults. Include a clear UA with a contact URL.
  //
  // Ref: OSM tile usage policy requires a unique User-Agent identifying the application.
  // https://operations.osmfoundation.org/policies/tiles/
  const userAgent = "remcochat/0.18.8 (static-map-proxy)";
  const requestHeaders = {
    accept: "image/*",
    "user-agent": userAgent,
  };

  let lastError: unknown;

  if (stadiaApiKey) {
    try {
      const url = buildStadiaStaticMapUrl({
        latitude,
        longitude,
        zoom,
        size,
        apiKey: stadiaApiKey,
      });
      const { contentType, bytes } = await fetchImage(url, requestHeaders);
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=86400, immutable",
        },
      });
    } catch (err) {
      lastError = err;
    }
  }

  try {
    const png = await renderOsmStaticMapPng({
      latitude,
      longitude,
      zoom,
      width,
      height,
      headers: requestHeaders,
    });
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    lastError = err;
  }

  return NextResponse.json(
    {
      error: "All map providers failed.",
      detail: safeErrorDetails(lastError),
    },
    { status: 502 }
  );
}
