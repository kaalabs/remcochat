"use client";

import type { WeatherToolOutput } from "@/ai/weather";
import { iconForWeatherCode } from "@/components/weather-icons";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MapPin, Wind } from "lucide-react";

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

export function Weather(props: WeatherToolOutput) {
  const daily = (props.daily ?? []).slice(0, 3);
  const CurrentIcon = iconForWeatherCode(props.current.weatherCode);

    return (
    <Card
      className="w-full max-w-md overflow-hidden border-border/60 bg-sky-100/80 shadow-xs dark:bg-sky-950/20"
      data-testid="tool:displayWeather"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-4">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2">
            Weather <Badge variant="secondary">Now</Badge>
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            <MapPin className="size-3.5" />
            <span className="min-w-0 truncate">{props.resolvedLocation}</span>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1">
            <div className="flex items-end gap-3">
              <CurrentIcon className="size-10 text-muted-foreground" />
              <div className="text-4xl font-semibold leading-none tracking-tight">
                {formatNumber(props.current.temperatureC)}°C
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {props.current.condition}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="gap-1.5" variant="outline">
              <Wind className="size-3.5" />
              {formatNumber(props.current.windKph)} km/h
            </Badge>
          </div>
        </div>
        {daily.length > 0 ? (
          <div className="grid gap-2">
            {daily.map((day) => {
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
                    <span className="text-foreground">
                      {formatNumber(day.maxC)}°
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      / {formatNumber(day.minC)}°
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
