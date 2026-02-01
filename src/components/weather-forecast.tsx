"use client";

import type { WeatherForecastToolOutput } from "@/ai/weather";
import { iconForWeatherCode } from "@/components/weather-icons";
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

function formatDay(date: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
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
              Weather Forecast
              <Badge variant="secondary">Next {props.forecastDays} days</Badge>
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
            alt={`Map of ${props.resolvedLocation}`}
            className="h-[150px] w-full object-cover"
            loading="lazy"
          />
        </a>
      </CardHeader>
      <CardContent className="grid gap-2 pt-4">
        <div className="grid grid-cols-[minmax(7.25rem,auto)_auto_minmax(0,1fr)_auto] items-center gap-x-3 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <div>Day</div>
          <div />
          <div>Condition</div>
          <div className="text-right">Hi / Lo</div>
        </div>
        {days.map((day) => {
          const DayIcon = iconForWeatherCode(day.weatherCode);
          return (
            <div
              className="grid grid-cols-[minmax(7.25rem,auto)_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-sm hover:bg-muted/30"
              key={day.date}
            >
              <div className="min-w-0 truncate text-muted-foreground">
                {formatDay(day.date, props.timezone)}
              </div>
              <DayIcon className="size-4 text-muted-foreground" />
              <div className="min-w-0 truncate text-muted-foreground">
                {day.condition}
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
