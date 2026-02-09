"use client";

import type { WeatherForecastToolOutput } from "@/ai/weather";
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
import { CalendarDays, MapPin } from "lucide-react";

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

function formatDay(locale: string, date: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: timezone || "UTC",
    }).format(new Date(date));
  } catch {
    return date;
  }
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

export function WeatherForecast(props: WeatherForecastToolOutput) {
  const { locale, t } = useI18n();
  const days = (props.daily ?? []).slice(0, props.forecastDays || 7);

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-border/60 bg-sky-100/75 shadow-xs dark:bg-sky-950/20"
      data-testid="tool:displayWeatherForecast"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-0">
        <div className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0 flex-1 grid gap-1">
            <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
              {t("weather.forecast.title")}
              <Badge variant="secondary">
                {t("weather.forecast.badge.next_days", { days: props.forecastDays })}
              </Badge>
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <MapPin className="size-3.5" />
              <span className="min-w-0 truncate">{props.resolvedLocation}</span>
            </CardDescription>
          </div>
          <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/70 shadow-xs">
            <CalendarDays className="size-5 shrink-0" />
          </div>
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
      <CardContent className="grid gap-2 pt-4">
        <div className="grid grid-cols-[minmax(7.25rem,auto)_auto_minmax(0,1fr)_auto] items-center gap-x-3 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <div>{t("common.day")}</div>
          <div />
          <div>{t("common.condition")}</div>
          <div className="text-right">{t("common.hi_lo")}</div>
        </div>
        {days.map((day) => {
          const DayIcon = iconForWeatherCode(day.weatherCode);
          const condition = labelForWeatherCode(t, day.weatherCode);
          return (
            <div
              className="grid grid-cols-[minmax(7.25rem,auto)_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-sm hover:bg-muted/30"
              key={day.date}
            >
              <div className="min-w-0 truncate text-muted-foreground">
                {formatDay(locale, day.date, props.timezone)}
              </div>
              <DayIcon className="size-4 text-muted-foreground" />
              <div className="min-w-0 truncate text-muted-foreground">
                {condition}
              </div>
              <div className="tabular-nums text-right">
                <span className="text-foreground">{formatNumber(day.maxC)}°</span>
                <span className="text-muted-foreground">
                  {" "}
                  / {formatNumber(day.minC)}°
                </span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
