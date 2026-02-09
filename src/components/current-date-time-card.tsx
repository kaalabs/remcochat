"use client";

import type { CurrentDateTimeToolOutput } from "@/ai/current-date-time";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CalendarClock } from "lucide-react";

export function CurrentDateTimeCard(props: CurrentDateTimeToolOutput) {
  const { t } = useI18n();
  return (
    <Card
      className="w-full max-w-md overflow-hidden border-emerald-200/70 bg-emerald-50/80 shadow-xs dark:border-emerald-500/50 dark:bg-emerald-500/15"
      data-testid="tool:displayCurrentDateTime"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60 bg-transparent pb-4">
        <div className="min-w-0 flex-1 grid gap-1">
          <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
            {t("current_date_time.title")}{" "}
            <Badge variant="secondary">{t("weather.badge.now")}</Badge>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span className="min-w-0 truncate">
              {props.zone.label || props.zone.timeZone}
            </span>
            <span className="text-muted-foreground">•</span>
            <span className="tabular-nums">{props.local.dateTimeISO}</span>
            <span className="text-muted-foreground">•</span>
            <span className="tabular-nums">{props.zone.offset}</span>
          </CardDescription>
        </div>
        <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/70 shadow-xs">
          <CalendarClock className="size-5 shrink-0" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="grid gap-1 rounded-md border border-border/60 bg-background/60 px-3 py-2">
          <div className="text-xs text-muted-foreground">{t("time.local")}</div>
          <div className="font-semibold tabular-nums">{props.local.dateISO}</div>
          <div className="tabular-nums">{props.local.time24}</div>
          <div className="text-xs text-muted-foreground">{props.local.dateLabel}</div>
        </div>
        <div className="grid gap-1 rounded-md border border-border/60 bg-background/60 px-3 py-2">
          <div className="text-xs text-muted-foreground">{t("time.utc")}</div>
          <div className="tabular-nums">{props.nowUtcISO}</div>
        </div>
      </CardContent>
    </Card>
  );
}
