import { WEATHER_HOURLY_FORECAST_HOURS } from "@/lib/weather-constants";

export type WeatherToolOutput = {
  location: string;
  resolvedLocation: string;
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    temperatureC: number;
    weatherCode: number;
    windKph: number;
    condition: string;
  };
  hourly: Array<{
    time: string;
    temperatureC: number;
    weatherCode: number;
    condition: string;
  }>;
};

export type WeatherForecastToolOutput = {
  location: string;
  resolvedLocation: string;
  latitude: number;
  longitude: number;
  timezone: string;
  forecastDays: number;
  daily: Array<{
    date: string;
    minC: number;
    maxC: number;
    weatherCode: number;
    condition: string;
  }>;
};

type GeocodingResult = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
};

function weatherCodeToLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return "Unknown";
}

function formatResolvedLocation(result: GeocodingResult): string {
  const parts = [
    result.name,
    result.admin1?.trim() || "",
    result.country?.trim() || "",
  ].filter(Boolean);
  return parts.join(", ");
}

async function geocodeLocation(location: string): Promise<GeocodingResult> {
  async function geocodeOnce(query: string): Promise<GeocodingResult | null> {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", query);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");

    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Geocoding failed (${response.status}).`);
    }

    const json = (await response.json()) as {
      results?: Array<{
        name: string;
        latitude: number;
        longitude: number;
        country?: string;
        admin1?: string;
      }>;
    };

    const first = json.results?.[0];
    if (!first) return null;

    return {
      name: first.name,
      latitude: first.latitude,
      longitude: first.longitude,
      country: first.country,
      admin1: first.admin1,
    };
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  addCandidate(location);
  if (location.includes(",")) {
    addCandidate(location.split(",")[0] ?? "");
  }
  addCandidate(location.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " "));

  for (const candidate of candidates) {
    const hit = await geocodeOnce(candidate);
    if (hit) return hit;
  }

  throw new Error(`No matches for location: "${location}".`);
}

async function fetchCurrentWeather(input: {
  latitude: number;
  longitude: number;
  forecastHours: number;
}) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(input.latitude));
  url.searchParams.set("longitude", String(input.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,weather_code,wind_speed_10m"
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,weather_code"
  );
  url.searchParams.set("forecast_hours", String(input.forecastHours));
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Forecast failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    timezone?: string;
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      weather_code?: number[];
    };
  };

  const current = json.current;
  const hourly = json.hourly;
  if (!current || typeof current.temperature_2m !== "number") {
    throw new Error("Weather provider returned no current conditions.");
  }

  return {
    timezone: json.timezone || "UTC",
    current: {
      temperatureC: current.temperature_2m,
      weatherCode: Number(current.weather_code ?? NaN),
      condition: weatherCodeToLabel(Number(current.weather_code ?? NaN)),
      windKph: Number(current.wind_speed_10m ?? 0),
    },
    hourly: (hourly?.time ?? []).map((time, idx) => ({
      time,
      temperatureC: Number(hourly?.temperature_2m?.[idx] ?? NaN),
      weatherCode: Number(hourly?.weather_code?.[idx] ?? NaN),
      condition: weatherCodeToLabel(Number(hourly?.weather_code?.[idx] ?? NaN)),
    })),
  };
}

async function fetchForecast(input: {
  latitude: number;
  longitude: number;
  forecastDays: number;
}) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(input.latitude));
  url.searchParams.set("longitude", String(input.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,weather_code,wind_speed_10m"
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,weather_code"
  );
  url.searchParams.set("forecast_days", String(input.forecastDays));
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Forecast failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    timezone?: string;
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
    daily?: {
      time?: string[];
      temperature_2m_min?: number[];
      temperature_2m_max?: number[];
      weather_code?: number[];
    };
  };

  const current = json.current;
  const daily = json.daily;
  if (!current || typeof current.temperature_2m !== "number") {
    throw new Error("Weather provider returned no current conditions.");
  }

  return {
    timezone: json.timezone || "UTC",
    current: {
      temperatureC: current.temperature_2m,
      weatherCode: Number(current.weather_code ?? NaN),
      condition: weatherCodeToLabel(Number(current.weather_code ?? NaN)),
      windKph: Number(current.wind_speed_10m ?? 0),
    },
    daily: (daily?.time ?? []).map((date, idx) => ({
      date,
      minC: Number(daily?.temperature_2m_min?.[idx] ?? NaN),
      maxC: Number(daily?.temperature_2m_max?.[idx] ?? NaN),
      weatherCode: Number(daily?.weather_code?.[idx] ?? NaN),
      condition: weatherCodeToLabel(Number(daily?.weather_code?.[idx] ?? NaN)),
    })),
  };
}

export async function getWeatherForLocation(input: {
  location: string;
  forecastHours?: number;
}): Promise<WeatherToolOutput> {
  const location = (input.location ?? "").trim();
  if (!location) throw new Error("Missing location.");

  const geo = await geocodeLocation(location);
  const forecastHours = Math.min(
    24,
    Math.max(
      1,
      Math.floor(input.forecastHours ?? WEATHER_HOURLY_FORECAST_HOURS)
    )
  );
  const forecast = await fetchCurrentWeather({
    latitude: geo.latitude,
    longitude: geo.longitude,
    forecastHours,
  });

  return {
    location,
    resolvedLocation: formatResolvedLocation(geo),
    latitude: geo.latitude,
    longitude: geo.longitude,
    timezone: forecast.timezone,
    current: forecast.current,
    hourly: forecast.hourly,
  };
}

export async function getWeatherForecastForLocation(input: {
  location: string;
  forecastDays?: number;
}): Promise<WeatherForecastToolOutput> {
  const location = (input.location ?? "").trim();
  if (!location) throw new Error("Missing location.");

  const geo = await geocodeLocation(location);
  const forecastDays = Math.min(
    14,
    Math.max(1, Math.floor(input.forecastDays ?? 7))
  );
  const forecast = await fetchForecast({
    latitude: geo.latitude,
    longitude: geo.longitude,
    forecastDays,
  });

  return {
    location,
    resolvedLocation: formatResolvedLocation(geo),
    latitude: geo.latitude,
    longitude: geo.longitude,
    timezone: forecast.timezone,
    forecastDays,
    daily: forecast.daily,
  };
}
