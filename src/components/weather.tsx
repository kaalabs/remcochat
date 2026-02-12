"use client";

import type { WeatherToolOutput } from "@/ai/weather";
import { iconForWeatherCode } from "@/components/weather-icons";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StaticMapPreview } from "@/components/static-map-preview";
import { WEATHER_HOURLY_FORECAST_HOURS } from "@/lib/weather-constants";
import { MapPin, Wind } from "lucide-react";
import { createElement } from "react";

function labelForWeatherCode(
  t: ReturnType<typeof useI18n>["t"],
  code: number
): string {
  if (code === 0) return t("weather.code.clear");
  if (code === 1) return t("weather.code.mostly_clear");
  if (code === 2) return t("weather.code.partly_cloudy");
  if (code === 3) return t("weather.code.overcast");
  if (code === 45 || code === 48) return t("weather.code.fog");
  if (code >= 51 && code <= 57) return t("weather.code.drizzle");
  if (code >= 61 && code <= 67) return t("weather.code.rain");
  if (code >= 71 && code <= 77) return t("weather.code.snow");
  if (code >= 80 && code <= 82) return t("weather.code.rain_showers");
  if (code === 85 || code === 86) return t("weather.code.snow_showers");
  if (code === 95) return t("weather.code.thunderstorm");
  if (code === 96 || code === 99) return t("weather.code.thunderstorm_hail");
  return t("weather.code.unknown");
}

function formatHour(locale: string, time: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      timeZone: timezone || "UTC",
    }).format(new Date(time));
  } catch {
    return time;
  }
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

export function Weather(props: WeatherToolOutput) {
  const { locale, t } = useI18n();
  const hourly = (props.hourly ?? []).slice(0, WEATHER_HOURLY_FORECAST_HOURS);
  const currentIcon = iconForWeatherCode(props.current.weatherCode);
  const currentCondition = labelForWeatherCode(t, props.current.weatherCode);

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-border/60 bg-sky-100/80 shadow-xs dark:bg-sky-950/20"
      data-testid="tool:displayWeather"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-0">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2">
            {t("weather.title")} <Badge variant="secondary">{t("weather.badge.now")}</Badge>
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            <MapPin className="size-3.5" />
            <span className="min-w-0 truncate">{props.resolvedLocation}</span>
          </CardDescription>
        </div>
        <a
          href={`https://www.openstreetmap.org/?mlat=${props.latitude}&mlon=${props.longitude}&zoom=15`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block overflow-hidden rounded-md border border-border/40"
        >
          <StaticMapPreview
            latitude={props.latitude}
            longitude={props.longitude}
            alt={t("map.alt.location", { location: props.resolvedLocation })}
            className="h-[150px] w-full object-cover"
            loading="lazy"
          />
        </a>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1">
            <div className="flex items-end gap-3">
              {createElement(currentIcon, {
                className: "size-10 text-muted-foreground",
              })}
              <div className="text-4xl font-semibold leading-none tracking-tight">
                {formatNumber(props.current.temperatureC)}°C
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {currentCondition}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="gap-1.5" variant="outline">
              <Wind className="size-3.5" />
              {formatNumber(props.current.windKph)} km/h
            </Badge>
          </div>
        </div>
        {hourly.length > 0 ? (
          <div className="grid gap-2">
            {hourly.map((hour) => {
              const hourIcon = iconForWeatherCode(hour.weatherCode);
              const condition = labelForWeatherCode(t, hour.weatherCode);
              return (
                <div
                  className="grid grid-cols-[minmax(4rem,auto)_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-sm hover:bg-muted/30"
                  key={hour.time}
                >
                  <div className="min-w-0 truncate text-muted-foreground">
                    {formatHour(locale, hour.time, props.timezone)}
                  </div>
                  {createElement(hourIcon, { className: "size-4 text-muted-foreground" })}
                  <div className="min-w-0 truncate text-muted-foreground">
                    {condition}
                  </div>
                  <div className="tabular-nums text-right">
                    <span className="text-foreground">
                      {formatNumber(hour.temperatureC)}°
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
